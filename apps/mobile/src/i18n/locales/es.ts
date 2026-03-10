/**
 * Spanish Translations
 * Traducciones en español para GigaPDF
 */

export default {
  common: {
    loading: 'Cargando...',
    error: 'Error',
    success: 'Éxito',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    delete: 'Eliminar',
    save: 'Guardar',
    edit: 'Editar',
    done: 'Hecho',
    back: 'Volver',
    next: 'Siguiente',
    skip: 'Saltar',
    retry: 'Reintentar',
    close: 'Cerrar',
    search: 'Buscar',
    filter: 'Filtrar',
    sort: 'Ordenar',
    share: 'Compartir',
    download: 'Descargar',
    upload: 'Subir',
    create: 'Crear',
    update: 'Actualizar',
    remove: 'Quitar',
    yes: 'Sí',
    no: 'No',
    ok: 'OK',
  },

  auth: {
    login: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    register: 'Registrarse',
    email: 'Correo electrónico',
    password: 'Contraseña',
    confirmPassword: 'Confirmar contraseña',
    forgotPassword: '¿Olvidaste tu contraseña?',
    resetPassword: 'Restablecer contraseña',
    name: 'Nombre',
    loginButton: 'Entrar',
    registerButton: 'Registrarse',
    alreadyHaveAccount: '¿Ya tienes una cuenta?',
    dontHaveAccount: '¿No tienes una cuenta?',
    loginWithGoogle: 'Continuar con Google',
    loginWithApple: 'Continuar con Apple',
    rememberMe: 'Recuérdame',

    errors: {
      invalidCredentials: 'Correo o contraseña inválidos',
      emailRequired: 'El correo es requerido',
      passwordRequired: 'La contraseña es requerida',
      nameRequired: 'El nombre es requerido',
      emailInvalid: 'El correo es inválido',
      passwordTooShort: 'La contraseña debe tener al menos 8 caracteres',
      passwordsDoNotMatch: 'Las contraseñas no coinciden',
      emailAlreadyExists: 'Este correo ya está en uso',
    },

    success: {
      loginSuccess: 'Inicio de sesión exitoso',
      registerSuccess: 'Registro exitoso',
      passwordResetSent: 'Correo de restablecimiento enviado',
      passwordResetSuccess: 'Contraseña restablecida exitosamente',
    },
  },

  documents: {
    title: 'Mis Documentos',
    myDocuments: 'Mis Documentos',
    recentDocuments: 'Documentos recientes',
    favorites: 'Favoritos',
    trash: 'Papelera',
    allDocuments: 'Todos los documentos',
    noDocuments: 'Sin documentos',
    noDocumentsDescription: 'Comienza subiendo tu primer documento PDF',
  },

  tools: {
    title: 'Herramientas PDF',
    allTools: 'Todas las herramientas',
    popularTools: 'Herramientas populares',
  },

  settings: {
    title: 'Configuración',
    account: 'Cuenta',
    profile: 'Perfil',
    preferences: 'Preferencias',
    security: 'Seguridad',
    subscription: 'Suscripción',
    about: 'Acerca de',
  },

  errors: {
    networkError: 'Error de red. Verifica tu conexión.',
    serverError: 'Error del servidor. Inténtalo de nuevo.',
    unknownError: 'Ocurrió un error inesperado',
    fileTooBig: 'El archivo es demasiado grande',
    invalidFileType: 'Tipo de archivo inválido',
    operationFailed: 'La operación falló',
    unauthorized: 'No autorizado',
    forbidden: 'Acceso denegado',
    notFound: 'Recurso no encontrado',
    timeout: 'Tiempo de espera agotado',
  },

  validation: {
    required: 'Este campo es requerido',
    email: 'Correo inválido',
    minLength: 'Mínimo {{min}} caracteres',
    maxLength: 'Máximo {{max}} caracteres',
    passwordMatch: 'Las contraseñas deben coincidir',
    invalidFormat: 'Formato inválido',
  },
};
