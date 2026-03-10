/**
 * English Translations
 * English translations for GigaPDF
 */

// For now, using same structure as French - to be translated
export default {
  common: {
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    save: 'Save',
    edit: 'Edit',
    done: 'Done',
    back: 'Back',
    next: 'Next',
    skip: 'Skip',
    retry: 'Retry',
    close: 'Close',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    share: 'Share',
    download: 'Download',
    upload: 'Upload',
    create: 'Create',
    update: 'Update',
    remove: 'Remove',
    yes: 'Yes',
    no: 'No',
    ok: 'OK',
  },

  auth: {
    login: 'Login',
    logout: 'Logout',
    register: 'Register',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    forgotPassword: 'Forgot Password?',
    resetPassword: 'Reset Password',
    name: 'Name',
    loginButton: 'Sign In',
    registerButton: 'Sign Up',
    alreadyHaveAccount: 'Already have an account?',
    dontHaveAccount: "Don't have an account?",
    loginWithGoogle: 'Continue with Google',
    loginWithApple: 'Continue with Apple',
    rememberMe: 'Remember me',

    errors: {
      invalidCredentials: 'Invalid email or password',
      emailRequired: 'Email is required',
      passwordRequired: 'Password is required',
      nameRequired: 'Name is required',
      emailInvalid: 'Email is invalid',
      passwordTooShort: 'Password must be at least 8 characters',
      passwordsDoNotMatch: 'Passwords do not match',
      emailAlreadyExists: 'This email is already in use',
    },

    success: {
      loginSuccess: 'Login successful',
      registerSuccess: 'Registration successful',
      passwordResetSent: 'Reset email sent',
      passwordResetSuccess: 'Password reset successful',
    },
  },

  documents: {
    title: 'My Documents',
    myDocuments: 'My Documents',
    recentDocuments: 'Recent Documents',
    favorites: 'Favorites',
    trash: 'Trash',
    allDocuments: 'All Documents',
    noDocuments: 'No documents',
    noDocumentsDescription: 'Start by uploading your first PDF document',
    createDocument: 'Create document',
    uploadDocument: 'Upload document',
    renameDocument: 'Rename document',
    deleteDocument: 'Delete document',
    restoreDocument: 'Restore document',
    duplicateDocument: 'Duplicate document',
    moveToFolder: 'Move to folder',
    addToFavorites: 'Add to favorites',
    removeFromFavorites: 'Remove from favorites',
    documentDetails: 'Document details',

    properties: {
      name: 'Name',
      size: 'Size',
      pages: 'Pages',
      created: 'Created',
      modified: 'Modified',
      format: 'Format',
      author: 'Author',
    },

    actions: {
      open: 'Open',
      share: 'Share',
      download: 'Download',
      delete: 'Delete',
      rename: 'Rename',
      duplicate: 'Duplicate',
      favorite: 'Favorite',
      move: 'Move',
      restore: 'Restore',
    },

    errors: {
      uploadFailed: 'Upload failed',
      deleteFailed: 'Delete failed',
      renameFailed: 'Rename failed',
      notFound: 'Document not found',
    },

    success: {
      uploaded: 'Document uploaded successfully',
      deleted: 'Document deleted successfully',
      renamed: 'Document renamed successfully',
      duplicated: 'Document duplicated successfully',
      restored: 'Document restored successfully',
    },
  },

  tools: {
    title: 'PDF Tools',
    allTools: 'All Tools',
    popularTools: 'Popular Tools',
    // ... (rest similar to French version)
  },

  settings: {
    title: 'Settings',
    account: 'Account',
    profile: 'Profile',
    preferences: 'Preferences',
    security: 'Security',
    subscription: 'Subscription',
    about: 'About',
    // ... (rest similar to French version)
  },

  errors: {
    networkError: 'Network error. Please check your connection.',
    serverError: 'Server error. Please try again.',
    unknownError: 'An unexpected error occurred',
    fileTooBig: 'File is too large',
    invalidFileType: 'Invalid file type',
    operationFailed: 'Operation failed',
    unauthorized: 'Unauthorized',
    forbidden: 'Access denied',
    notFound: 'Resource not found',
    timeout: 'Request timeout',
  },

  validation: {
    required: 'This field is required',
    email: 'Invalid email',
    minLength: 'Minimum {{min}} characters',
    maxLength: 'Maximum {{max}} characters',
    passwordMatch: 'Passwords must match',
    invalidFormat: 'Invalid format',
  },
};
