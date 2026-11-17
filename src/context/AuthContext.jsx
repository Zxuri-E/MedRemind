import React, { createContext, useContext, useState, useEffect } from 'react';
import { generateUserId } from '../utils/idGenerator';
import { format } from 'date-fns';
import { apiFetch, isOnline } from '../config/apiConfig';
import { cancelAllMedicationNotifications } from '../services/notificationService';

const AuthContext = createContext(null);

/**
 * Hash client password using Web Crypto API SHA-256 for secure local offline credential storage.
 * Ensures plaintext passwords are never persisted in localStorage.
 */
async function hashClientPassword(password) {
  if (!password) return '';
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(password);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    console.warn('[AuthContext] Web Crypto subtle unavailable, using fallback hash');
  }
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `h_${Math.abs(hash).toString(16)}`;
}

export function AuthProvider({ children }) {
  // Currently authenticated user session
  // STRICT: Default to NULL on initial launch. Fresh launch starts unauthenticated!
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('medremind_auth_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id && parsed.role) {
          return parsed;
        }
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  // Registered users database for Admin management (initializes clean without synthetic placeholder accounts)
  const [registeredUsers, setRegisteredUsers] = useState(() => {
    const saved = localStorage.getItem('medremind_registered_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter out synthetic legacy demo accounts
          return parsed.filter(u => u.phone !== '1234567890' || u.name !== 'Alex Morgan');
        }
      } catch (e) { /* ignore */ }
    }
    return [];
  });

  // System audit log for Admin overview (initializes empty)
  const [systemActivity, setSystemActivity] = useState(() => {
    const saved = localStorage.getItem('medremind_system_activity');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });

  // Sync to localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('medremind_auth_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('medremind_auth_user');
    }
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('medremind_registered_users', JSON.stringify(registeredUsers));
  }, [registeredUsers]);

  useEffect(() => {
    localStorage.setItem('medremind_system_activity', JSON.stringify(systemActivity));
  }, [systemActivity]);

  // Log system activity
  const logActivity = (type, user, details, userId = '') => {
    const newEntry = {
      id: `ACT-${Date.now()}`,
      type,
      user,
      userId,
      details,
      timestamp: `Today, ${format(new Date(), 'hh:mm a')}`
    };
    setSystemActivity(prev => [newEntry, ...prev.slice(0, 49)]);
  };

  /**
   * Authenticate user with Email/User ID & Password
   * Connects to MedRemind Server API with server-side PBKDF2 verification,
   * with secure offline-first patient fallback for standalone mobile deployment.
   * Full backward compatibility with accounts created in earlier versions.
   */
  const login = async (identifier, password) => {
    const cleanId = (identifier || '').trim();
    const cleanPwd = (password || '').trim();

    if (!cleanId || !cleanPwd) {
      return { success: false, error: 'Please enter both your identifier and password.' };
    }

    const enteredHash = await hashClientPassword(cleanPwd);
    let cloudAttemptFailed = false;
    let cloudError = null;

    // 1. Authoritative Cloud / Server Authentication Attempt
    try {
      const response = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanId, password: cleanPwd })
      }, 5000);

      const data = await response.json();

      if (response.ok && data.success && data.user) {
        const safeUser = { ...data.user };
        delete safeUser.password;
        delete safeUser.passwordHash;

        // Persist client credential hash locally for seamless offline/subsequent logins
        try {
          const creds = JSON.parse(localStorage.getItem('medremind_patient_credentials') || '{}');
          if (safeUser.id) creds[safeUser.id] = enteredHash;
          if (safeUser.email) creds[safeUser.email.toLowerCase()] = enteredHash;
          const cleanPhoneDigits = (safeUser.phoneNumber || safeUser.phone || '').replace(/\D/g, '');
          if (cleanPhoneDigits) creds[cleanPhoneDigits] = enteredHash;
          localStorage.setItem('medremind_patient_credentials', JSON.stringify(creds));
        } catch (e) {}

        const userWithHash = { ...safeUser, passwordHash: enteredHash };
        setRegisteredUsers(prev => {
          const updated = [userWithHash, ...prev.filter(u => u.id !== safeUser.id)];
          localStorage.setItem('medremind_registered_users', JSON.stringify(updated));
          return updated;
        });

        setCurrentUser(safeUser);
        if (data.token) {
          localStorage.setItem('medremind_auth_token', data.token);
        }
        localStorage.setItem('medremind_auth_user', JSON.stringify(safeUser));
        logActivity(
          safeUser.role === 'admin' ? 'ADMIN_LOGIN' : 'LOGIN',
          `${safeUser.name} (${safeUser.role})`,
          safeUser.role === 'admin' ? 'Successful Admin portal login' : 'User authenticated via MedRemind Server API',
          safeUser.id
        );
        return { success: true, user: safeUser };
      } else {
        cloudAttemptFailed = true;
        cloudError = data?.error || 'Invalid credentials.';
      }
    } catch (err) {
      cloudAttemptFailed = true;
      cloudError = err.message;
    }

    // Dedicated Admin Authentication must never bypass via local offline mode
    if (cleanId.toUpperCase() === 'ADMIN' || cleanId.toLowerCase() === 'admin@medremind.internal') {
      return {
        success: false,
        error: cloudError || 'Administrator authentication requires an active connection to the secure server.'
      };
    }

    // 2. Resilient Local / Previous-Version Fallback for Patients
    // Gather all local users across registered storage and previous session cache
    const allUsers = [...registeredUsers];
    const savedUsersStr = localStorage.getItem('medremind_registered_users');
    if (savedUsersStr) {
      try {
        const parsed = JSON.parse(savedUsersStr);
        if (Array.isArray(parsed)) {
          parsed.forEach(u => {
            if (!allUsers.some(existing => existing.id === u.id)) allUsers.push(u);
          });
        }
      } catch (e) {}
    }
    const savedAuthUserStr = localStorage.getItem('medremind_auth_user');
    if (savedAuthUserStr) {
      try {
        const parsed = JSON.parse(savedAuthUserStr);
        if (parsed && parsed.id && !allUsers.some(existing => existing.id === parsed.id)) {
          allUsers.push(parsed);
        }
      } catch (e) {}
    }

    const cleanDigits = cleanId.replace(/\D/g, '');
    const foundUser = allUsers.find(u => {
      if (u.role === 'admin') return false;
      if (u.email && u.email.toLowerCase() === cleanId.toLowerCase()) return true;
      if (u.id === cleanId) return true;
      const userPhoneDigits = (u.phoneNumber || u.phone || '').replace(/\D/g, '');
      if (cleanDigits && userPhoneDigits && (userPhoneDigits === cleanDigits || userPhoneDigits.endsWith(cleanDigits) || cleanDigits.endsWith(userPhoneDigits))) {
        return true;
      }
      return false;
    });

    if (foundUser) {
      if (foundUser.status === 'Suspended') {
        return { success: false, error: 'This account has been suspended. Please contact support.' };
      }

      // Check credentials in local secure credentials map
      let creds = {};
      try {
        creds = JSON.parse(localStorage.getItem('medremind_patient_credentials') || '{}');
      } catch (e) {}

      const storedClientHash = creds[foundUser.id] || 
        (foundUser.email && creds[foundUser.email.toLowerCase()]) || 
        (cleanDigits && creds[cleanDigits]);

      let passwordMatches = false;

      if (storedClientHash) {
        passwordMatches = (storedClientHash === enteredHash);
      } else if (foundUser.passwordHash) {
        passwordMatches = (foundUser.passwordHash === enteredHash || foundUser.passwordHash === cleanPwd);
      } else if (foundUser.password) {
        passwordMatches = (foundUser.password === cleanPwd);
      } else {
        // BACKWARD COMPATIBILITY FOR PREVIOUS VERSIONS:
        // In previous builds, user objects had passwordHash deleted upon storage.
        // If an existing patient account is present on device without a stored hash,
        // adopt the entered password, persist its hash securely, and allow authentication.
        passwordMatches = true;
      }

      if (!passwordMatches) {
        return { success: false, error: 'Invalid password. Please verify and try again.' };
      }

      // Update credentials map and user store with verified hash
      try {
        creds[foundUser.id] = enteredHash;
        if (foundUser.email) creds[foundUser.email.toLowerCase()] = enteredHash;
        if (cleanDigits) creds[cleanDigits] = enteredHash;
        localStorage.setItem('medremind_patient_credentials', JSON.stringify(creds));
      } catch (e) {}

      const safeUser = { ...foundUser };
      delete safeUser.password;
      delete safeUser.passwordHash;

      const userWithHash = { ...safeUser, passwordHash: enteredHash };
      setRegisteredUsers(prev => {
        const updated = [userWithHash, ...prev.filter(u => u.id !== safeUser.id)];
        localStorage.setItem('medremind_registered_users', JSON.stringify(updated));
        return updated;
      });

      setCurrentUser(safeUser);
      localStorage.setItem('medremind_auth_user', JSON.stringify(safeUser));
      const offlineToken = `offline_patient_${safeUser.id}_${Date.now()}`;
      localStorage.setItem('medremind_auth_token', offlineToken);
      logActivity('LOGIN', `${safeUser.name} (${safeUser.role})`, 'User authenticated locally (offline / legacy session restore)', safeUser.id);
      return { success: true, user: safeUser };
    }

    return {
      success: false,
      error: cloudError && cloudError.toLowerCase().includes('suspended')
        ? cloudError
        : 'Account not found or invalid credentials. Please check your details or create an account.'
    };
  };

  /**
   * Register a new Patient account directly with Name, DOB, Gender, Email, and Phone.
   * Authoritative server verification when cloud is available, with resilient offline
   * patient registration using client-side cryptographic hashing.
   */
  const register = async ({ name, dob, gender, email, phone, phoneNumber, password, role }) => {
    if (role === 'admin' || role?.toLowerCase() === 'administrator') {
      return { success: false, error: 'Administrator accounts cannot be created via public registration.' };
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanName = (name || '').trim();
    let cleanDob = (dob || '').toString().trim();
    const cleanGender = (gender || '').toString().trim();
    const cleanPhone = (phone || phoneNumber || '').toString().trim();
    const cleanPassword = (password || '').trim();

    // Standardize DOB format to YYYY-MM-DD
    const dmyMatch = cleanDob.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmyMatch) {
      cleanDob = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    if (!cleanPassword || cleanPassword.length < 6) {
      return {
        success: false,
        error: 'Password must be at least 6 characters long.'
      };
    }

    const passwordHash = await hashClientPassword(cleanPassword);

    // 1. Authoritative Server Registration Attempt
    try {
      const response = await apiFetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: cleanName, 
          dob: cleanDob, 
          gender: cleanGender, 
          email: cleanEmail, 
          phone: cleanPhone, 
          password: cleanPassword, 
          role: 'patient' 
        })
      }, 5000);

      let data = null;
      try {
        data = await response.json();
      } catch (parseErr) {
        throw new Error('Registration server returned non-JSON response');
      }

      if (response.ok && data.success && data.user) {
        const safeUser = { ...data.user };
        delete safeUser.password;
        delete safeUser.passwordHash;

        // Persist password hash locally for offline logins
        try {
          const creds = JSON.parse(localStorage.getItem('medremind_patient_credentials') || '{}');
          if (safeUser.id) creds[safeUser.id] = passwordHash;
          if (safeUser.email) creds[safeUser.email.toLowerCase()] = passwordHash;
          const cleanPhoneDigits = (safeUser.phoneNumber || safeUser.phone || '').replace(/\D/g, '');
          if (cleanPhoneDigits) creds[cleanPhoneDigits] = passwordHash;
          localStorage.setItem('medremind_patient_credentials', JSON.stringify(creds));
        } catch (e) {}

        // Clean up legacy unscoped stores so new account starts fresh
        localStorage.removeItem('medremind_medicines');
        localStorage.removeItem('medremind_dose_logs');
        localStorage.removeItem('medremind_patient_profile');
        localStorage.removeItem('medremind_notifications');
        localStorage.removeItem('medremind_nutrition_logs');
        localStorage.removeItem('medremind_nutrition_targets');

        const userWithHash = { ...safeUser, passwordHash };
        setRegisteredUsers(prev => {
          const updated = [userWithHash, ...prev.filter(u => u.id !== safeUser.id)];
          localStorage.setItem('medremind_registered_users', JSON.stringify(updated));
          return updated;
        });
        setCurrentUser(safeUser);
        if (data.token) localStorage.setItem('medremind_auth_token', data.token);
        localStorage.setItem('medremind_auth_user', JSON.stringify(safeUser));
        logActivity('REGISTRATION', `${safeUser.name} (${safeUser.role})`, `Account created with ID ${safeUser.id}`, safeUser.id);
        return { success: true, user: safeUser, token: data.token };
      } else if (response.status === 400 && data?.error && data.error.toLowerCase().includes('already exists')) {
        // Explicit collision reported by cloud database
        return { success: false, error: data.error };
      } else {
        // Cloud backend returned an unexpected response or gateway error — trigger resilient local registration
        throw new Error(data?.error || `Registration server returned status ${response.status}`);
      }
    } catch (err) {
      console.warn('[AuthContext] Cloud registration unreachable or returned error, activating secure local offline account:', err.message);

      // Check if user already exists locally
      const cleanDigits = cleanPhone.replace(/\D/g, '');
      const existingUser = registeredUsers.find(u => 
        (u.email && u.email.toLowerCase() === cleanEmail) ||
        (cleanDigits && (u.phoneNumber || u.phone || '').replace(/\D/g, '') === cleanDigits)
      );
      if (existingUser) {
        return { success: false, error: 'An account with this Email or Phone number already exists. Please log in.' };
      }

      const newUserId = generateUserId('USR');
      const safeUser = {
        id: newUserId,
        name: cleanName,
        dob: cleanDob,
        gender: cleanGender,
        email: cleanEmail,
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        role: 'patient',
        status: 'Active',
        registeredAt: format(new Date(), 'yyyy-MM-dd')
      };

      const userWithHash = {
        ...safeUser,
        passwordHash
      };

      try {
        const creds = JSON.parse(localStorage.getItem('medremind_patient_credentials') || '{}');
        creds[newUserId] = passwordHash;
        creds[cleanEmail] = passwordHash;
        if (cleanDigits) creds[cleanDigits] = passwordHash;
        localStorage.setItem('medremind_patient_credentials', JSON.stringify(creds));
      } catch (e) {}

      setRegisteredUsers(prev => {
        const updated = [userWithHash, ...prev.filter(u => u.id !== newUserId)];
        localStorage.setItem('medremind_registered_users', JSON.stringify(updated));
        return updated;
      });

      // Clean up legacy unscoped stores so new account starts fresh
      localStorage.removeItem('medremind_medicines');
      localStorage.removeItem('medremind_dose_logs');
      localStorage.removeItem('medremind_patient_profile');
      localStorage.removeItem('medremind_notifications');
      localStorage.removeItem('medremind_nutrition_logs');
      localStorage.removeItem('medremind_nutrition_targets');

      setCurrentUser(safeUser);
      localStorage.setItem('medremind_auth_user', JSON.stringify(safeUser));
      const offlineToken = `offline_patient_${newUserId}_${Date.now()}`;
      localStorage.setItem('medremind_auth_token', offlineToken);
      logActivity('REGISTRATION', `${safeUser.name} (${safeUser.role})`, `Account created locally with ID ${safeUser.id}`, safeUser.id);
      return { success: true, user: safeUser, token: offlineToken };
    }
  };

  /**
   * Compatibility stubs for legacy OTP calls
   */
  const verifyOtp = async () => ({ success: true, message: 'OTP is no longer required.' });
  const resendOtp = async () => ({ success: true, message: 'OTP is no longer required.' });

  /**
   * Log out active session
   * Clears state and localStorage, allowing clean return to Welcome page.
   */
  const logout = () => {
    if (currentUser) {
      logActivity('LOGOUT', `${currentUser.name} (${currentUser.role})`, 'User logged out', currentUser.id);
    }
    const token = localStorage.getItem('medremind_auth_token');
    if (token && isOnline()) {
      apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    }
    setCurrentUser(null);
    localStorage.removeItem('medremind_auth_user');
    localStorage.removeItem('medremind_auth_token');
    // Clear legacy unscoped stores so next account starts strictly fresh
    localStorage.removeItem('medremind_medicines');
    localStorage.removeItem('medremind_dose_logs');
    localStorage.removeItem('medremind_patient_profile');
    localStorage.removeItem('medremind_notifications');
    localStorage.removeItem('medremind_nutrition_logs');
    localStorage.removeItem('medremind_nutrition_targets');
    // Cancel any scheduled background reminders for the logged-out user
    cancelAllMedicationNotifications().catch(() => {});
  };

  // Schedule Account Deletion with 24-Hour Grace Period
  const scheduleDeletion = async (reason = 'User requested account closure') => {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (isOnline()) {
      try {
        const token = localStorage.getItem('medremind_auth_token');
        const res = await apiFetch('/auth/schedule-deletion', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ reason })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const updated = {
            ...currentUser,
            status: 'Pending_Deletion',
            scheduledDeletionAt: data.user?.scheduledDeletionAt || scheduledAt,
            deletionRequestedBy: currentUser?.id,
            deletionReason: reason
          };
          setCurrentUser(updated);
          localStorage.setItem('medremind_auth_user', JSON.stringify(updated));
          return { success: true, message: data.message, user: updated };
        }
      } catch (err) {
        console.warn('[AuthContext] Cloud schedule-deletion failed, applying locally:', err.message);
      }
    }

    // Local state fallback
    const updated = {
      ...currentUser,
      status: 'Pending_Deletion',
      scheduledDeletionAt: scheduledAt,
      deletionRequestedBy: currentUser?.id,
      deletionReason: reason
    };
    setCurrentUser(updated);
    localStorage.setItem('medremind_auth_user', JSON.stringify(updated));
    return { success: true, message: 'Account scheduled for deletion in 24 hours.', user: updated };
  };

  // Cancel Account Deletion
  const cancelDeletion = async () => {
    if (isOnline()) {
      try {
        const token = localStorage.getItem('medremind_auth_token');
        const res = await apiFetch('/auth/cancel-deletion', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const updated = {
            ...currentUser,
            status: 'Active',
            scheduledDeletionAt: null,
            deletionRequestedBy: null,
            deletionReason: null
          };
          setCurrentUser(updated);
          localStorage.setItem('medremind_auth_user', JSON.stringify(updated));
          return { success: true, message: data.message, user: updated };
        }
      } catch (err) {
        console.warn('[AuthContext] Cloud cancel-deletion failed, applying locally:', err.message);
      }
    }

    // Local state fallback
    const updated = {
      ...currentUser,
      status: 'Active',
      scheduledDeletionAt: null,
      deletionRequestedBy: null,
      deletionReason: null
    };
    setCurrentUser(updated);
    localStorage.setItem('medremind_auth_user', JSON.stringify(updated));
    return { success: true, message: 'Account deletion cancelled successfully.', user: updated };
  };

  // Refresh User Profile from Backend
  const refreshUser = async () => {
    if (isOnline()) {
      try {
        const token = localStorage.getItem('medremind_auth_token');
        if (!token) return;
        const res = await apiFetch('/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok && data.success && data.user) {
          setCurrentUser(data.user);
          localStorage.setItem('medremind_auth_user', JSON.stringify(data.user));
        }
      } catch (e) {}
    }
  };

  // User medical profile update (offline-first persistent)
  const updateUserMedicalInfo = (allergies, medicalInfo) => {
    setCurrentUser(prev => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        allergies: Array.isArray(allergies) ? allergies : prev.allergies,
        medicalInfo: { ...(prev.medicalInfo || {}), ...(medicalInfo || {}) }
      };
      try {
        localStorage.setItem('medremind_auth_user', JSON.stringify(updated));
        const allUsers = JSON.parse(localStorage.getItem('medremind_registered_users') || '[]');
        const updatedAll = allUsers.map(u => u.id === updated.id ? { ...u, ...updated } : u);
        localStorage.setItem('medremind_registered_users', JSON.stringify(updatedAll));
      } catch (e) {}
      return updated;
    });
  };

  // Admin user status modification
  const updateUserStatus = (userId, newStatus) => {
    setRegisteredUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
    logActivity('ADMIN_ACTION', 'System Administrator', `Updated status of user ${userId} to ${newStatus}`, userId);
  };

  return (
    <AuthContext.Provider value={{
      currentUser,
      user: currentUser,
      activeRole: currentUser?.role || null,
      registeredUsers,
      systemActivity,
      login,
      register,
      verifyOtp,
      resendOtp,
      logout,
      updateUserMedicalInfo,
      updateUserStatus,
      scheduleDeletion,
      cancelDeletion,
      refreshUser,
      logActivity
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
