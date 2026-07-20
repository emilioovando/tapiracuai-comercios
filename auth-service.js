// Tapiracuai Auth - modo local preparado para Supabase
(function(){
  var USERS_KEY='tapiracuai_users';
  var SESSION_KEY='tapiracuai_auth_session';
  var ADMIN_EMAIL='emiliojavi29@gmail.com';
  var LEGACY_KEYS=['users','tapiracuai_demo_accounts'];
  var didMigrateLegacy=false;

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch(e){return fallback}}
  function writeJson(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function normalizeEmail(email){return String(email||'').trim().toLowerCase()}
  function isAdminEmail(email){return normalizeEmail(email)===ADMIN_EMAIL}
  function validEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))}
  function validPassword(value){value=String(value||'');return value.length>=8&&/[A-Za-z]/.test(value)&&/\d/.test(value)}
  function nowId(){return 'user_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}
  function firstError(list){return list.filter(Boolean)[0]||''}
  function supabaseUnavailableError(){
    if(!window.TapiracuaiSupabase)return 'TapiracuaiSupabase no existe. Probablemente supabase-client.js no cargó o tuvo un error de JavaScript.';
    return TapiracuaiSupabase.connectionError||'TapiracuaiSupabase existe, pero no se pudo crear el cliente.';
  }
  function normalizeProfiles(raw,role,businessData){
    var profiles=Array.isArray(raw&&raw.profiles)?raw.profiles.slice():[];
    if(role&&profiles.indexOf(role)===-1)profiles.push(role);
    if(businessData&&profiles.indexOf('comercio')===-1)profiles.push('comercio');
    if(profiles.indexOf('cliente')===-1)profiles.unshift('cliente');
    return profiles.filter(function(v,i,a){return ['cliente','comercio'].indexOf(v)>-1&&a.indexOf(v)===i});
  }
  function mergeUsersByEmail(list){
    var byEmail={};
    (list||[]).map(normalizeUser).forEach(function(user){
      if(!user.email||isAdminEmail(user.email))return;
      var current=byEmail[user.email];
      if(!current){byEmail[user.email]=user;return}
      current.name=current.name||user.name;
      current.whatsapp=current.whatsapp||user.whatsapp;
      current.password=current.password||user.password;
      current.businessData=current.businessData||user.businessData;
      current.profiles=normalizeProfiles({profiles:(current.profiles||[]).concat(user.profiles||[])},current.role,current.businessData);
      if(user.role==='comercio'||current.businessData)current.role='comercio';
    });
    return Object.keys(byEmail).map(function(email){return byEmail[email]});
  }
  function uniqueByEmail(list){return mergeUsersByEmail(list)}
  function normalizeUser(raw){
    raw=raw||{};
    var role=raw.role||'cliente';
    var businessData=raw.businessData||null;
    if(role==='comercio'&&!businessData){
      businessData={businessName:raw.businessName||raw.name||'Mi comercio',rubro:raw.rubro||raw.category||'General',categoryStatus:raw.categoryStatus||'aprobada',responsable:raw.responsable||raw.owner||'',whatsapp:raw.whatsapp||'',direccion:raw.direccion||raw.address||''};
    }
    return {id:raw.id||nowId(),role:role,name:raw.name||raw.businessName||businessData&&businessData.businessName||'',email:normalizeEmail(raw.email),whatsapp:raw.whatsapp||businessData&&businessData.whatsapp||'',password:raw.password||raw.demoPassword||'',businessData:businessData,profiles:normalizeProfiles(raw,role,businessData),createdAt:raw.createdAt||new Date().toISOString()};
  }
  function migrateLegacyUsers(){
    var migrated=readJson(USERS_KEY,[]).map(normalizeUser);
    LEGACY_KEYS.forEach(function(key){readJson(key,[]).forEach(function(user){migrated.push(normalizeUser(user))})});
    migrated=uniqueByEmail(migrated);
    writeJson(USERS_KEY,migrated);
    if(window.TapiracuaiData)window.TapiracuaiData.sync();
    return migrated;
  }
  function users(){if(!didMigrateLegacy){didMigrateLegacy=true;return migrateLegacyUsers()}return readJson(USERS_KEY,[]).map(normalizeUser).filter(function(user){return !isAdminEmail(user.email)})}
  function saveUsers(list){writeJson(USERS_KEY,uniqueByEmail((list||[]).map(normalizeUser)));if(window.TapiracuaiData)window.TapiracuaiData.sync()}
  function findUser(email){email=normalizeEmail(email);return users().find(function(user){return normalizeEmail(user.email)===email})}
  function saveCommerce(user){
    if(!user||user.role!=='comercio'||!user.businessData)return;
    var data={id:user.id,ownerUserId:user.id,name:user.businessData.businessName||user.name||'Mi comercio',nombre:user.businessData.businessName||user.name||'Mi comercio',rubro:user.businessData.rubro||'General',categoryStatus:user.businessData.categoryStatus||'aprobada',responsable:user.businessData.responsable||'',whatsapp:user.businessData.whatsapp||'',direccion:user.businessData.direccion||'',email:normalizeEmail(user.email),active:true,estado:'active',products:[],promos:[],createdAt:user.createdAt||new Date().toISOString()};
    var legacy=readJson('tapiracuai_comercios',[]).filter(function(c){return normalizeEmail(c.email)!==data.email});legacy.push(data);writeJson('tapiracuai_comercios',legacy);
    var businesses=readJson('tapiracuai_businesses',[]).filter(function(c){return normalizeEmail(c.email)!==data.email});
    businesses.push({id:user.id,ownerUserId:user.id,email:data.email,name:data.name,nombre:data.name,rubro:data.rubro,categories:[data.rubro],categoryStatus:data.categoryStatus,customCategory:'',owner:data.responsable,responsable:data.responsable,whatsapp:data.whatsapp,address:data.direccion,direccion:data.direccion,lat:'',lng:'',hours:'',paymentMethods:[],description:'',logo:'',cover:'',portada:'',photos:[],verified:true,active:true,estado:'active',createdAt:data.createdAt,updatedAt:new Date().toISOString()});
    writeJson('tapiracuai_businesses',businesses);
    if(window.TapiracuaiData)window.TapiracuaiData.publishBusiness(businesses[businesses.length-1],user);
  }
  function validateRegister(payload){
    var role=payload.role;
    return firstError([!role&&'Elegí el tipo de cuenta.',role&&['cliente','comercio'].indexOf(role)===-1&&'Elegí un tipo de cuenta válido.',!payload.email&&'Ingresá el correo.',payload.email&&!validEmail(payload.email)&&'Ingresá un correo válido.',!payload.password&&'Ingresá una contraseña.',payload.password&&!validPassword(payload.password)&&'La contraseña debe tener mínimo 8 caracteres, una letra y un número.',payload.password!==payload.confirmPassword&&'Las contraseñas no coinciden.']);
  }
  async function register(payload){
    payload=payload||{};
    payload.email=normalizeEmail(payload.email);
    var error=validateRegister(payload);
    if(error)throw new Error(error);
    if(isAdminEmail(payload.email))throw new Error('Este correo corresponde al administrador. Usa iniciar sesion.');
    if(window.TapiracuaiSupabase&&TapiracuaiSupabase.available){
      var active=getSession();
      if(active&&active.user&&normalizeEmail(active.user.email)===payload.email&&payload.role==='comercio'){
        var business=await TapiracuaiSupabase.activateCommerceProfile(payload.businessData||{businessName:payload.businessName||'Mi comercio'});
        var roles=Array.isArray(active.user.profiles)?active.user.profiles.slice():['cliente'];
        if(roles.indexOf('comercio')===-1)roles.push('comercio');
        var merged=Object.assign({},active.user,{role:'comercio',businessData:payload.businessData||active.user.businessData||null,profiles:roles});
        setSession(merged,'comercio');
        if(business)localStorage.setItem('tapiracuai_force_commerce_profile','1');
        return sanitizeUser(merged);
      }
      var supaUser=await TapiracuaiSupabase.signUp({role:payload.role,email:payload.email,password:payload.password,name:payload.name,businessName:payload.businessName,businessData:payload.businessData});
      if(supaUser&&supaUser.pendingConfirmation)return sanitizeUser(supaUser);
      setSession(supaUser,payload.role);
      if(payload.role==='comercio')localStorage.setItem('tapiracuai_force_commerce_profile','1');
      return sanitizeUser(Object.assign({},supaUser,{role:payload.role}));
    }
    throw new Error(supabaseUnavailableError());
    var list=users(), existing=findUser(payload.email), user;
    if(existing){
      if(String(existing.password)!==String(payload.password))throw new Error('Este correo ya existe. Ingresá la misma contraseña para sumar este perfil.');
      if((existing.profiles||[]).indexOf(payload.role)>-1)throw new Error('Este correo ya tiene ese perfil.');
      user=existing;
      user.profiles=normalizeProfiles({profiles:user.profiles},payload.role,user.businessData);
      if(payload.role==='comercio'){
        user.role='comercio';
        user.businessData=user.businessData||{businessName:'Mi comercio',rubro:'General',categoryStatus:'aprobada',responsable:'',whatsapp:'',direccion:''};
      }
      list=list.filter(function(x){return normalizeEmail(x.email)!==payload.email});list.push(user);
    }else{
      user={id:nowId(),role:payload.role,name:payload.role==='cliente'?payload.email.split('@')[0]:'Mi comercio',email:payload.email,whatsapp:'',password:payload.password,businessData:payload.role==='comercio'?{businessName:'Mi comercio',rubro:'General',categoryStatus:'aprobada',responsable:'',whatsapp:'',direccion:''}:null,profiles:normalizeProfiles({},payload.role,payload.role==='comercio'),createdAt:new Date().toISOString()};
      list.push(user);
    }
    saveUsers(list);setSession(user,payload.role);if(payload.role==='comercio'){localStorage.setItem('tapiracuai_force_commerce_profile','1');saveCommerce(user)}return sanitizeUser(Object.assign({},user,{role:payload.role}));
  }
  async function login(email,password){
    email=normalizeEmail(email);
    if(!validEmail(email))throw new Error('Ingresá un correo válido');
    if(!password)throw new Error('Ingresá tu contraseña');
    if(window.TapiracuaiSupabase&&TapiracuaiSupabase.available){
      var supaUser=await TapiracuaiSupabase.signIn(email,password);
      if(isAdminEmail(email))supaUser.role='admin';
      setSession(supaUser);
      return sanitizeUser(supaUser);
    }
    throw new Error(supabaseUnavailableError());
    if(isAdminEmail(email)){var admin={id:'tapiracuai_admin',role:'admin',name:'Administrador Tapiracuai',email:ADMIN_EMAIL,whatsapp:'',businessData:null};setSession(admin);return sanitizeUser(admin)}
    var user=findUser(email);
    if(!user)throw new Error('Correo no registrado');
    if(String(user.password)!==String(password))throw new Error('Contraseña incorrecta');
    setSession(user);
    return sanitizeUser(user);
  }
  async function recover(email){
    email=normalizeEmail(email);
    if(!validEmail(email))throw new Error('Ingresá un correo válido');
    if(window.TapiracuaiSupabase&&TapiracuaiSupabase.available){
      await TapiracuaiSupabase.resetPassword(email);
      return true;
    }
    throw new Error(supabaseUnavailableError());
    if(isAdminEmail(email)||findUser(email))return true;
    throw new Error('Correo no registrado');
  }
  function setSession(user,mode){var clean=sanitizeUser(user);if(mode)clean.role=mode;writeJson(SESSION_KEY,{user:clean,active:true,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1000*60*60*24*30).toISOString()})}
  function getSession(){var session=readJson(SESSION_KEY,null);if(!session||!session.active||!session.user)return null;if(session.expiresAt&&new Date(session.expiresAt).getTime()<Date.now()){logout();return null}return session}
  function logout(){localStorage.removeItem(SESSION_KEY);if(window.TapiracuaiSupabase&&TapiracuaiSupabase.available)TapiracuaiSupabase.signOut()}
  function sanitizeUser(user){return {id:user.id,role:user.role,name:user.name,email:normalizeEmail(user.email),whatsapp:user.whatsapp||'',businessData:user.businessData||null,profiles:normalizeProfiles(user,user.role,user.businessData).concat((Array.isArray(user.profiles)?user.profiles:[]).filter(function(v){return v==='admin'})).filter(function(v,i,a){return a.indexOf(v)===i})}}
  function redirectForRole(role){if(role==='administrador'||role==='admin')return 'admin-dashboard.html';if(role==='comercio')return 'comercio-dashboard.html';var pending=localStorage.getItem('tapiracuai_pending_store_id');return pending?'index.html?openStore='+encodeURIComponent(pending):'index.html'}
  function switchMode(mode){var session=getSession();if(!session||!session.user)throw new Error('Inicia sesion para cambiar de modo.');var user=findUser(session.user.email)||session.user;if((user.profiles||[]).indexOf(mode)===-1)throw new Error('Este perfil no esta disponible para tu cuenta.');setSession(user,mode);return sanitizeUser(Object.assign({},user,{role:mode}))}
  function showMessage(target,message,type){var el=typeof target==='string'?document.querySelector(target):target;if(!el)return;el.textContent=message;el.className='auth-message '+(type||'info');el.hidden=false}
  function diagnostic(){console.log('Tapiracuai usuarios guardados:',users())}

  window.TapiracuaiAuth={register:register,login:login,recover:recover,logout:logout,getSession:getSession,switchMode:switchMode,redirectForRole:redirectForRole,showMessage:showMessage,validEmail:validEmail,validPassword:validPassword,users:users,diagnostic:diagnostic,normalizeEmail:normalizeEmail};
})();
