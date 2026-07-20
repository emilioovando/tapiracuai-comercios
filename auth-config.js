// Tapiracuai Auth config - Supabase conectado para produccion.

var TAPIRACUAI_PRODUCTION_URL = 'https://tubular-tartufo-9465bb.netlify.app';

window.TAPIRACUAI_AUTH_CONFIG = {
  supabaseUrl: 'https://sumdkaybsgwoipdxuozi.supabase.co',
  supabaseAnonKey: 'sb_publishable_vrIJBw42REPYxnPI2Xd8cw_WYoIT-yO',
  productionUrl: TAPIRACUAI_PRODUCTION_URL,
  appUrl: TAPIRACUAI_PRODUCTION_URL,
  routes: {
    home: 'index.html',
    login: 'login.html',
    register: 'registro.html',
    recoverPassword: 'recuperar-password.html',
    businessDashboard: 'comercio-dashboard.html',
    adminDashboard: 'admin-dashboard.html'
  },
  roles: {
    client: 'cliente',
    business: 'comercio',
    admin: 'administrador'
  },
  providers: {
    google: true,
    facebook: false
  },
  storage: {
    businessLogosBucket: 'business-logos',
    businessCoversBucket: 'business-covers',
    userAvatarsBucket: 'user-avatars'
  }
};
