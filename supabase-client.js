// Tapiracuai Supabase bridge - Supabase is the primary data source.
(function(){
  var cfg=window.TAPIRACUAI_AUTH_CONFIG||{};
  var ADMIN_EMAIL='emiliojavi29@gmail.com';
  var STORAGE_KEYS={
    users:'tapiracuai_users',
    session:'tapiracuai_auth_session',
    businesses:'tapiracuai_businesses',
    legacyBusinesses:'tapiracuai_comercios',
    products:'tapiracuai_products',
    promotions:'tapiracuai_promotions',
    favorites:'tapiracuai_favorites',
    reviews:'tapiracuai_reviews',
    stats:'tapiracuai_stats',
    updateRequests:'tapiracuai_update_requests',
    clientProfiles:'tapiracuai_client_profiles',
    infoBanners:'tapiracuai_info_banners'
  };
  var BANNERS_ENABLED=false;
  var connectionError='';
  if(!window.supabase)connectionError='La librería Supabase no se cargó. Revisá la conexión a https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  else if(!cfg.supabaseUrl)connectionError='Falta supabaseUrl en auth-config.js';
  else if(!cfg.supabaseAnonKey)connectionError='Falta supabaseAnonKey en auth-config.js';
  else if(cfg.supabaseUrl.indexOf('supabase.co')===-1)connectionError='supabaseUrl no parece una URL válida de Supabase: '+cfg.supabaseUrl;
  var hasClient=!connectionError;
  var client=null;
  if(hasClient){
    try{
      client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      if(!client||!client.auth)connectionError='createClient no devolvió un cliente Supabase válido.';
    }catch(error){
      connectionError=error&&error.message?error.message:String(error);
      client=null;
    }
  }
  var rawSetItem=Storage.prototype.setItem;
  var rawRemoveItem=Storage.prototype.removeItem;
  var syncPaused=false;
  var syncingKeys={};

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch(e){return fallback}}
  function writeCache(key,value){syncPaused=true;try{rawSetItem.call(localStorage,key,JSON.stringify(value))}finally{syncPaused=false}}
  function normalizeEmail(email){return String(email||'').trim().toLowerCase()}
  function appBaseUrl(){var base=cfg.appUrl||cfg.productionUrl||location.origin;return String(base).replace(/\/+$/,'')}
  function authRedirectUrl(page){return appBaseUrl()+'/'+String(page||'login.html').replace(/^\/+/,'')}
  function isAdminEmail(email){return normalizeEmail(email)===ADMIN_EMAIL}
  function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))}
  function uuid(){return crypto&&crypto.randomUUID?crypto.randomUUID():''}
  function slugify(value,tail){return String(value||'tapiracuai').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,52)+(tail?'-'+String(tail).slice(0,8):'')}
  function n(value){var num=Number(value);return Number.isFinite(num)?num:null}
  function publicUrl(bucket,path){if(!client||!path)return '';return client.storage.from(bucket).getPublicUrl(path).data.publicUrl||''}
  function friendlyError(error){
    var message=String(error&&error.message||error||'').toLowerCase();
    if(message.indexOf('email rate limit')>-1||message.indexOf('rate limit')>-1){
      return 'Se realizaron demasiados intentos. Esperá unos minutos y volvé a intentar.';
    }
    return error&&error.message||String(error||'No se pudo completar la operación.');
  }
  function adminLoginError(error,email){
    var raw=error&&error.message||String(error||'');
    if(isAdminEmail(email)&&/invalid login credentials/i.test(raw)){
      return raw+'. El correo administrador debe existir en Supabase Authentication, estar confirmado y usar la contraseña correcta. Si no existe, crealo manualmente en Authentication con '+ADMIN_EMAIL+' y luego iniciá sesión.';
    }
    return friendlyError(error);
  }
  function requireClient(){
    if(client)return client;
    throw new Error(connectionError||('No se pudo crear el cliente Supabase. URL configurada: '+(cfg.supabaseUrl||'sin URL')+'. Librería cargada: '+(window.supabase?'sí':'no')+'. Publishable key configurada: '+(cfg.supabaseAnonKey?'sí':'no')+'.'));
  }
  function dispatch(name,detail){document.dispatchEvent(new CustomEvent(name,{detail:detail||{}}))}
  function mergeById(local,remote){var map={};(local||[]).forEach(function(x){if(x&&x.id)map[String(x.id)]=x});(remote||[]).forEach(function(x){if(x&&x.id)map[String(x.id)]=x});return Object.keys(map).map(function(k){return map[k]})}
  function sessionUser(){var s=readJson(STORAGE_KEYS.session,null);return s&&s.active?s.user:null}
  function scheduleFromHorarioRows(rows){
    var days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],schedule={};
    days.forEach(function(day){schedule[day]={closed:true}});
    (rows||[]).forEach(function(row){
      var day=days[Number(row.dia_semana)];
      if(!day)return;
      if(row.abierto===false){schedule[day]={type:'closed'};return}
      if(!row.abre&&!row.cierra){schedule[day]={type:'24_hours'};return}
      var period={open:String(row.abre||'').slice(0,5),close:String(row.cierra||'').slice(0,5)};
      if(schedule[day]&&schedule[day].type==='regular')schedule[day].periods.push(period);
      else schedule[day]={type:'regular',periods:[period],openTime:period.open,closeTime:period.close};
    });
    return schedule;
  }
  function scheduleRowsForBusiness(comercioId,schedule){
    var days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    if(!comercioId||!schedule)return [];
    var rows=[];
    days.forEach(function(day,idx){
      var item=schedule[day]||{},type=item.type||(item.closed===true?'closed':(item.type==='24_hours'?'24_hours':'regular'));
      if(type==='regular'&&Array.isArray(item.periods)&&item.periods.length){item.periods.forEach(function(p){rows.push({comercio_id:comercioId,dia_semana:idx,abierto:true,abre:p.open||p.openTime,cierra:p.close||p.closeTime})});return}
      rows.push({comercio_id:comercioId,dia_semana:idx,abierto:type!=='closed',abre:type==='regular'?(item.openTime||item.open||item.abre||'08:00'):null,cierra:type==='regular'?(item.closeTime||item.close||item.cierra||'18:00'):null});
    });
    return rows;
  }
  async function saveBusinessSchedule(comercioId,schedule){
    if(!client||!comercioId||!schedule||schedule._needsReview)return;
    var del=await client.from('comercio_horarios').delete().eq('comercio_id',comercioId);
    if(del.error)throw del.error;
    var rows=scheduleRowsForBusiness(comercioId,schedule);
    if(rows.length){var ins=await client.from('comercio_horarios').insert(rows);if(ins.error)throw ins.error}
  }

  function businessFromRow(row){
    var meta=row.metadata||{};
    var suspended=row.estado==='suspended';
    return {
      id:row.id,
      ownerUserId:row.owner_user_id,
      email:normalizeEmail(row.email_contacto||''),
      name:row.nombre||'Mi comercio',
      nombre:row.nombre||'Mi comercio',
      rubro:row.rubro||'General',
      categories:Array.isArray(row.categorias)&&row.categorias.length?row.categorias:[row.rubro||'General'],
      categoryStatus:'aprobada',
      customCategory:'',
      owner:row.responsable||'',
      responsable:row.responsable||'',
      whatsapp:row.whatsapp||'',
      address:row.direccion||'',
      direccion:row.direccion||'',
      lat:row.latitud==null?'':String(row.latitud),
      lng:row.longitud==null?'':String(row.longitud),
      hours:row.horario_texto||'',
      schedule:row.schedule||row.horarios||row.horario_json||null,
      paymentMethods:Array.isArray(row.metodos_pago)?row.metodos_pago:[],
      description:row.descripcion||'',
      logo:row.logo_url||'',
      cover:row.portada_url||'',
      portada:row.portada_url||'',
      photos:Array.isArray(row.fotos_urls)?row.fotos_urls:[],
      verified:row.verificado===true,
      featured:row.destacado===true,
      suspended:suspended,
      active:row.estado!=='inactive'&&!suspended,
      estado:row.estado||'active',
      suspensionReason:meta.suspension_reason||'',
      adminNotice:meta.admin_notice||null,
      rating:row.rating_promedio||0,
      reviews:row.total_opiniones||0,
      scheduleNeedsReview:!!meta.schedule_needs_review,
      createdAt:row.created_at,
      updatedAt:row.updated_at
    };
  }
  function businessToRow(b,user){
    b=b||{};user=user||sessionUser()||{};
    var sameOwnerEmail=normalizeEmail(b.email)&&normalizeEmail(user.email)&&normalizeEmail(b.email)===normalizeEmail(user.email);
    var id=isUuid(b.id)?b.id:(isUuid(b.ownerUserId)?b.ownerUserId:(isUuid(user.id)&&sameOwnerEmail?user.id:''));
    if(!id)return null;
    var cats=Array.isArray(b.categories)&&b.categories.length?b.categories:[b.rubro||b.category||'General'];
    var name=b.name||b.nombre||'Mi comercio';
    var estado=(b.estado==='suspended'||b.suspended===true)?'suspended':(b.active===false||b.estado==='inactive'?'inactive':'active');
    var metadata=Object.assign({},b.metadata||{});
    metadata.local_source='tapiracuai_static_app';
    metadata.schedule_needs_review=b.scheduleNeedsReview===true;
    if(b.suspensionReason)metadata.suspension_reason=b.suspensionReason;
    if(b.adminNotice)metadata.admin_notice=b.adminNotice;
    return {
      id:id,
      owner_user_id:isUuid(b.ownerUserId)?b.ownerUserId:(isUuid(user.id)&&sameOwnerEmail?user.id:id),
      nombre:name,
      slug:slugify(name,id),
      rubro:b.rubro||cats[0]||'General',
      categorias:cats,
      responsable:b.owner||b.responsable||'',
      whatsapp:b.whatsapp||'',
      email_contacto:normalizeEmail(b.email||user.email),
      direccion:b.address||b.direccion||'',
      latitud:n(b.lat),
      longitud:n(b.lng),
      horario_texto:b.hours||'',
      metodos_pago:Array.isArray(b.paymentMethods)?b.paymentMethods:[],
      descripcion:b.description||'',
      logo_url:b.logo||'',
      portada_url:b.cover||b.portada||'',
      fotos_urls:Array.isArray(b.photos)?b.photos:[],
      verificado:b.verified===true,
      destacado:b.featured===true,
      estado:estado,
      metadata:metadata
    };
  }
  function productFromRow(row){
    return {id:row.id,businessId:row.comercio_id,name:row.nombre,description:row.descripcion||'',price:row.precio_gs||0,stock:row.stock==null?null:row.stock,category:row.metadata&&row.metadata.category||'',available:row.disponible!==false,active:row.activo!==false,featured:row.destacado===true,photo:row.imagen_url||'',createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function normalizePriceValue(value){
    return window.TapiracuaiPrice?TapiracuaiPrice.normalize(value):Math.max(0,parseInt(String(value==null?'':value).replace(/\D/g,''),10)||0);
  }
  function productToRow(p){
    if(!p||!isUuid(p.businessId))return null;
    var id=isUuid(p.id)?p.id:uuid();
    var category=String(p.category||'').trim();
    var categoryId=p.categoryId||p.categoriaId||p.categoria_id||'';
    var stock=p.stock===''||p.stock==null?null:Number(p.stock);
    if(!Number.isFinite(stock))stock=null;
    var payload={id:id,comercio_id:p.businessId,nombre:p.name||'Producto',slug:slugify(p.name||'producto',id),descripcion:p.description||'',precio_gs:normalizePriceValue(p.price),stock:stock,disponible:p.available!==false,activo:p.active!==false,destacado:p.featured===true,imagen_url:p.photo||'',metadata:{category:category||null}};
    if(isUuid(categoryId))payload.categoria_id=categoryId;
    Object.keys(payload).forEach(function(key){if(payload[key]==='')delete payload[key]});
    return payload;
  }
  function promoFromRow(row){
    return {id:row.id,businessId:row.comercio_id,title:row.titulo,description:row.descripcion||'',discount:row.descuento||'',start:row.fecha_inicio||'',end:row.fecha_fin||'',active:row.estado==='active',featured:row.destacada===true,image:row.imagen_url||'',createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function promoToRow(p){
    if(!p||!isUuid(p.businessId))return null;
    var id=isUuid(p.id)?p.id:uuid();
    var payload={id:id,comercio_id:p.businessId,titulo:p.title||'Promocion',descripcion:p.description||'',descuento:p.discount||'',fecha_inicio:p.start||null,fecha_fin:p.end||null,imagen_url:p.image||'',estado:p.active===false?'paused':'active',destacada:p.featured===true,metadata:{}};
    var productId=p.productId||p.productoId||p.producto_id||'';
    var categoryId=p.categoryId||p.categoriaId||p.categoria_id||'';
    if(isUuid(productId))payload.producto_id=productId;
    if(isUuid(categoryId))payload.categoria_id=categoryId;
    Object.keys(payload).forEach(function(key){if(payload[key]==='')delete payload[key]});
    return payload;
  }
  function reviewFromRow(row){
    return {id:row.id,businessId:row.comercio_id,userId:row.usuario_id,clientName:row.nombre_publico||'Cliente',stars:row.calificacion,comment:row.comentario||'',date:row.created_at,active:row.activa!==false};
  }
  function favoriteFromRow(row){
    var id=row.producto_id||row.comercio_id;
    return {id:id,key:row.id,userId:row.usuario_id,type:row.producto_id?'producto':'comercio',label:'Favorito',createdAt:row.created_at};
  }
  function statFromRow(row){
    return {id:row.id,businessId:row.comercio_id,productId:row.producto_id||'',profileViews:row.visitas||0,whatsappClicks:row.clicks_whatsapp||0,searchViews:row.apariciones_busqueda||0,favorites:row.favoritos||0,date:row.fecha,updatedAt:row.updated_at};
  }
  function infoBannerFromRow(row){
    row=row||{};
    return {
      id:row.id,
      title:row.titulo||'',
      description:row.descripcion||'',
      image:row.imagen_url||'',
      startAt:row.fecha_inicio||'',
      endAt:row.fecha_fin||'',
      active:row.activo!==false,
      createdBy:row.creado_por||'',
      createdAt:row.created_at||'',
      updatedAt:row.updated_at||''
    };
  }
  function infoBannerToRow(b,user){
    b=b||{};user=user||sessionUser()||{};
    var id=isUuid(b.id)?b.id:uuid();
    if(!id)return null;
    return {
      id:id,
      titulo:String(b.title||'').trim(),
      descripcion:String(b.description||'').trim(),
      imagen_url:b.image||'',
      fecha_inicio:b.startAt||null,
      fecha_fin:b.endAt||null,
      activo:b.active!==false,
      creado_por:isUuid(user.id)?user.id:null,
      metadata:{timeZone:'America/Asuncion'}
    };
  }
  function userFromProfile(profile,roles){
    roles=Array.isArray(roles)&&roles.length?roles.slice():[profile.role||'cliente'];
    if(isAdminEmail(profile.email)&&roles.indexOf('admin')===-1)roles.push('admin');
    roles=roles.filter(function(v,i,a){return ['cliente','comercio','admin'].indexOf(v)>-1&&a.indexOf(v)===i});
    var preferred=roles.indexOf('admin')>-1?'admin':(roles.indexOf('comercio')>-1?'comercio':'cliente');
    return {id:profile.id,role:preferred,name:[profile.nombre,profile.apellido].filter(Boolean).join(' ')||profile.nombre||String(profile.email||'').split('@')[0],email:normalizeEmail(profile.email),whatsapp:profile.whatsapp||'',password:'',businessData:null,profiles:roles,active:profile.activo!==false,createdAt:profile.created_at};
  }
  function clientProfileFromRows(profile,clientRow){
    profile=profile||{};clientRow=clientRow||{};
    var parts=String(profile.nombre||'').split(' ');
    return {
      userId:profile.id||clientRow.usuario_id,
      email:normalizeEmail(profile.email),
      photo:clientRow.foto_url||profile.avatar_url||'',
      name:parts[0]||profile.nombre||'',
      lastName:parts.slice(1).join(' '),
      phone:profile.whatsapp||'',
      address:clientRow.direccion||profile.direccion||'',
      neighborhood:clientRow.barrio||profile.barrio||'',
      city:clientRow.ciudad||profile.ciudad||'Santaní',
      completed:clientRow.perfil_completo===true,
      updatedAt:profile.updated_at||clientRow.updated_at
    };
  }

  async function currentAuthUser(){if(!client)return null;var res=await client.auth.getUser();return res.data&&res.data.user||null}
  async function fetchUserProfile(authUser){
    if(!client||!authUser)return null;
    var res=await client.from('usuarios').select('*').eq('id',authUser.id).maybeSingle();
    if(res.error)throw res.error;
    if(!res.data)throw new Error('Tu cuenta existe en Auth, pero falta el perfil en usuarios. Ejecutá el SQL supabase-auth-trigger-clean.sql y volvé a intentar.');
    return res.data;
  }
  async function fetchUserRoles(authUser,profile){
    var roles=[];
    if(profile&&profile.role)roles.push(profile.role);
    if(authUser&&isAdminEmail(authUser.email))roles.push('admin');
    if(client&&authUser){
      try{
        var r=await client.from('usuario_roles').select('role').eq('usuario_id',authUser.id);
        if(!r.error)(r.data||[]).forEach(function(row){if(row&&row.role)roles.push(row.role)});
      }catch(e){}
      try{
        var b=await client.from('comercios').select('id').eq('owner_user_id',authUser.id).limit(1);
        if(!b.error&&b.data&&b.data.length)roles.push('comercio');
      }catch(e){}
      try{
        var c=await client.from('clientes').select('id').eq('usuario_id',authUser.id).limit(1);
        if(!c.error&&c.data&&c.data.length)roles.push('cliente');
      }catch(e){}
    }
    return roles.filter(function(v,i,a){return ['cliente','comercio','admin'].indexOf(v)>-1&&a.indexOf(v)===i});
  }
  async function ensureUserRole(role){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Inicia sesion para activar este perfil.');
    if(['cliente','comercio'].indexOf(role)===-1&&!isAdminEmail(user.email))throw new Error('Perfil no permitido.');
    try{
      var res=await client.from('usuario_roles').upsert({usuario_id:user.id,role:role},{onConflict:'usuario_id,role'});
      if(res.error&&String(res.error.message||'').indexOf('usuario_roles')===-1)throw res.error;
    }catch(e){console.warn('Tapiracuai roles multiples pendiente de SQL:',e.message)}
    return true;
  }
  async function ensureCommerceClientProfile(seed){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Inicia sesion para crear el perfil cliente.');
    seed=seed||{};
    await ensureUserRole('cliente');
    var profile=await fetchUserProfile(user);
    var clientRes=await client.from('clientes').select('*').eq('usuario_id',user.id).maybeSingle();
    if(clientRes.error)throw clientRes.error;
    var clientRow=clientRes.data||{};
    var fullName=String(seed.fullName||seed.name||'').trim();
    var parts=fullName.split(/\s+/).filter(Boolean);
    var updateUser={};
    if(!String(profile.nombre||'').trim()&&parts.length)updateUser.nombre=parts[0];
    if(!String(profile.apellido||'').trim()&&parts.length>1)updateUser.apellido=parts.slice(1).join(' ');
    if(!String(profile.whatsapp||'').trim()&&String(seed.whatsapp||'').trim())updateUser.whatsapp=String(seed.whatsapp||'').trim();
    if(Object.keys(updateUser).length){
      var userUpdate=await client.from('usuarios').update(updateUser).eq('id',user.id).select().single();
      if(userUpdate.error)throw userUpdate.error;
      profile=userUpdate.data;
    }
    var complete=!!(String(profile.nombre||'').trim()&&String(profile.whatsapp||'').trim());
    var clientPayload={
      usuario_id:user.id,
      foto_url:clientRow.foto_url||profile.avatar_url||'',
      direccion:clientRow.direccion||profile.direccion||'',
      barrio:clientRow.barrio||profile.barrio||'',
      ciudad:clientRow.ciudad||profile.ciudad||'Santaní',
      perfil_completo:clientRow.perfil_completo===true||complete
    };
    var up=await client.from('clientes').upsert(clientPayload,{onConflict:'usuario_id'}).select().single();
    if(up.error)throw up.error;
    var roles=await fetchUserRoles(user,profile);
    return userFromProfile(profile,roles);
  }
  async function createBusinessForUser(authUser,businessData){
    if(!client||!authUser)return null;
    var existing=await client.from('comercios').select('*').eq('owner_user_id',authUser.id).maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data)return businessFromRow(existing.data);
    businessData=businessData||{};
    var name=businessData.businessName||businessData.name||'Mi comercio';
    var row=businessToRow({
      id:authUser.id,
      ownerUserId:authUser.id,
      email:authUser.email,
      name:name,
      rubro:businessData.rubro||businessData.category||'General',
      categories:[businessData.rubro||businessData.category||'General'],
      owner:businessData.responsable||businessData.owner||'',
      whatsapp:businessData.whatsapp||'',
      address:businessData.direccion||businessData.address||'',
      active:true
    },{id:authUser.id,email:authUser.email});
    var res=await client.from('comercios').upsert(row,{onConflict:'id'}).select().single();
    if(res.error)throw res.error;
    await client.from('comercio_configuraciones').upsert({comercio_id:res.data.id},{onConflict:'comercio_id'});
    return businessFromRow(res.data);
  }
  async function activateCommerceProfile(businessData){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Inicia sesion para activar el comercio.');
    await ensureUserRole('comercio');
    return createBusinessForUser(user,businessData||{});
  }
  async function fetchOwnBusiness(){
    requireClient();
    var user=await currentAuthUser();
    if(!user)return null;
    var res=await client.from('comercios').select('*').eq('owner_user_id',user.id).order('created_at',{ascending:false}).limit(1);
    if(res.error)throw res.error;
    if(!res.data||!res.data.length)return null;
    var row=res.data[0];
    var item=businessFromRow(row);
    try{
      var h=await client.from('comercio_horarios').select('*').eq('comercio_id',row.id);
      if(!h.error&&h.data&&h.data.length)item.schedule=scheduleFromHorarioRows(h.data);
    }catch(error){console.warn('Tapiracuai Supabase horarios:',error&&error.message?error.message:error)}
    var cached=readJson(STORAGE_KEYS.businesses,[]).filter(function(x){return String(x.id)!==String(item.id)&&String(x.ownerUserId)!==String(item.ownerUserId)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.businesses,cached);
    return item;
  }

  async function signIn(email,password){
    requireClient();
    email=normalizeEmail(email);
    var res=await client.auth.signInWithPassword({email:email,password:password});
    if(res.error)throw new Error(adminLoginError(res.error,email));
    var profile=await fetchUserProfile(res.data.user);
    var roles=await fetchUserRoles(res.data.user,profile);
    if(profile&&profile.role==='comercio')await createBusinessForUser(res.data.user,{businessName:res.data.user.user_metadata&&res.data.user.user_metadata.businessName||'Mi comercio',rubro:res.data.user.user_metadata&&res.data.user.user_metadata.rubro||'General'});
    await hydrateAll();
    return userFromProfile(profile,roles);
  }
  async function signUp(payload){
    requireClient();
    payload=payload||{};
    var email=normalizeEmail(payload.email);
    var metadata={name:payload.name||payload.businessName||email.split('@')[0],role:payload.role||'cliente',businessName:payload.businessData&&payload.businessData.businessName||payload.businessName||'',rubro:payload.businessData&&payload.businessData.rubro||'General'};
    var res=await client.auth.signUp({email:email,password:payload.password,options:{data:metadata,emailRedirectTo:authRedirectUrl('login.html')}});
    if(res.error)throw new Error(friendlyError(res.error));
    if(!res.data.user)throw new Error('No se pudo crear la cuenta.');
    var role=payload.role||'cliente';
    var session=res.data.session;
    if(!session){
      try{
        var login=await client.auth.signInWithPassword({email:email,password:payload.password});
        if(!login.error)session=login.data&&login.data.session;
      }catch(error){}
    }
    if(session){
      if(role==='comercio'){
        await ensureUserRole('comercio');
        await createBusinessForUser(res.data.user,payload.businessData||{businessName:metadata.businessName,rubro:metadata.rubro});
      }
      return {id:res.data.user.id,email:email,role:role,name:metadata.name,businessData:payload.businessData||null,profiles:[role],pendingConfirmation:false};
    }
    return {id:res.data.user.id,email:email,role:role,name:metadata.name,businessData:payload.businessData||null,profiles:[role],pendingConfirmation:true};
  }
  async function signOut(){if(client)await client.auth.signOut();rawRemoveItem.call(localStorage,STORAGE_KEYS.session)}
  async function resetPassword(email){
    requireClient();
    var res=await client.auth.resetPasswordForEmail(normalizeEmail(email),{redirectTo:authRedirectUrl('recuperar-password.html')});
    if(res.error)throw new Error(friendlyError(res.error));
    return true;
  }

  async function hydratePublic(){
    if(!client)return;
    var b=await client.from('comercios').select('*').order('created_at',{ascending:false});
    if(!b.error){
      var schedulesByBusiness={};
      try{
        var h=await client.from('comercio_horarios').select('*');
        if(!h.error)(h.data||[]).forEach(function(row){var id=row.comercio_id;if(!id)return;(schedulesByBusiness[id]=schedulesByBusiness[id]||[]).push(row)});
      }catch(error){console.warn('Tapiracuai Supabase horarios:',error&&error.message?error.message:error)}
      writeCache(STORAGE_KEYS.businesses,(b.data||[]).map(function(row){var item=businessFromRow(row);if(schedulesByBusiness[row.id])item.schedule=scheduleFromHorarioRows(schedulesByBusiness[row.id]);return item}));
    }
    var p=await client.from('productos').select('*').order('created_at',{ascending:false});
    if(!p.error)writeCache(STORAGE_KEYS.products,(p.data||[]).map(productFromRow));
    var pr=await client.from('promociones').select('*').order('created_at',{ascending:false});
    if(!pr.error)writeCache(STORAGE_KEYS.promotions,(pr.data||[]).map(promoFromRow));
    var r=await client.from('opiniones').select('*').order('created_at',{ascending:false});
    if(!r.error)writeCache(STORAGE_KEYS.reviews,(r.data||[]).map(reviewFromRow));
    try{
      if(!BANNERS_ENABLED)throw null;
      var bi=await client.from('banners_informativos').select('*').order('created_at',{ascending:false});
      if(!bi.error)writeCache(STORAGE_KEYS.infoBanners,(bi.data||[]).map(infoBannerFromRow));
    }catch(error){if(error)console.warn('Tapiracuai Supabase banners:',error&&error.message?error.message:error)}
  }
  async function hydratePrivate(){
    if(!client)return;
    var user=await currentAuthUser();
    if(!user)return;
    var u=await client.from('usuarios').select('*').order('created_at',{ascending:false});
    var rolesByUser={};
    if(!u.error)(u.data||[]).forEach(function(row){rolesByUser[row.id]=[row.role].filter(Boolean)});
    try{
      var ur=await client.from('usuario_roles').select('usuario_id,role');
      if(!ur.error)(ur.data||[]).forEach(function(row){if(!rolesByUser[row.usuario_id])rolesByUser[row.usuario_id]=[];rolesByUser[row.usuario_id].push(row.role)});
    }catch(e){}
    var c=await client.from('clientes').select('*').order('created_at',{ascending:false});
    if(!c.error)(c.data||[]).forEach(function(row){if(!rolesByUser[row.usuario_id])rolesByUser[row.usuario_id]=[];rolesByUser[row.usuario_id].push('cliente')});
    var cb=await client.from('comercios').select('owner_user_id').order('created_at',{ascending:false});
    if(!cb.error)(cb.data||[]).forEach(function(row){if(!rolesByUser[row.owner_user_id])rolesByUser[row.owner_user_id]=[];rolesByUser[row.owner_user_id].push('comercio')});
    if(!u.error)writeCache(STORAGE_KEYS.users,(u.data||[]).map(function(row){return userFromProfile(row,rolesByUser[row.id]||[row.role])}));
    if(!c.error&&!u.error){
      var byUser={};(c.data||[]).forEach(function(row){byUser[row.usuario_id]=row});
      writeCache(STORAGE_KEYS.clientProfiles,(u.data||[]).filter(function(row){return row.id===user.id||isAdminEmail(user.email)}).map(function(row){return clientProfileFromRows(row,byUser[row.id])}));
    }
    var f=await client.from('favoritos').select('*').order('created_at',{ascending:false});
    if(!f.error)writeCache(STORAGE_KEYS.favorites,(f.data||[]).map(favoriteFromRow));
    var s=await client.from('estadisticas').select('*').order('fecha',{ascending:false});
    if(!s.error)writeCache(STORAGE_KEYS.stats,(s.data||[]).map(statFromRow));
  }
  async function hydrateAll(){
    await hydratePublic();
    await hydratePrivate();
    dispatch('tapiracuai:data-updated',{source:'supabase'});
  }

  async function pushBusinesses(list,previous){
    var rows=(list||[]).map(function(b){return businessToRow(b)}).filter(Boolean);
    if(rows.length){
      var res=await client.from('comercios').upsert(rows,{onConflict:'id'});
      if(res.error)console.warn('Tapiracuai Supabase comercios:',res.error.message);
      else {
        for(var i=0;i<(list||[]).length;i++){
          if((list||[])[i]&&list[i].schedule&&list[i].schedule._needsReview!==true){
            try{await saveBusinessSchedule(rows[i]&&rows[i].id,list[i].schedule)}catch(error){console.warn('Tapiracuai Supabase horarios:',error.message)}
          }
        }
      }
    }
    await deleteRemoved('comercios',list,previous);
  }
  async function pushProducts(list,previous){
    var rows=(list||[]).map(productToRow).filter(Boolean);
    if(rows.length){var up=await client.from('productos').upsert(rows,{onConflict:'id'});if(up.error)console.warn('Tapiracuai Supabase productos:',up.error.message)}
    await deleteRemoved('productos',list,previous);
  }
  async function pushPromotions(list,previous){
    var rows=(list||[]).map(promoToRow).filter(Boolean);
    if(rows.length){var up=await client.from('promociones').upsert(rows,{onConflict:'id'});if(up.error)console.warn('Tapiracuai Supabase promociones:',up.error.message)}
    await deleteRemoved('promociones',list,previous);
  }
  async function deleteRemoved(table,next,previous){
    var nextIds={};(next||[]).forEach(function(x){if(isUuid(x&&x.id))nextIds[x.id]=true});
    var removed=(previous||[]).filter(function(x){return isUuid(x&&x.id)&&!nextIds[x.id]}).map(function(x){return x.id});
    if(removed.length){var res=await client.from(table).delete().in('id',removed);if(res.error)console.warn('Tapiracuai Supabase delete '+table+':',res.error.message)}
  }
  async function pushReviews(list,previous){
    var rows=(list||[]).filter(function(r){return isUuid(r.businessId)}).map(function(r){
      return {id:isUuid(r.id)?r.id:uuid(),comercio_id:r.businessId,usuario_id:isUuid(r.userId)?r.userId:null,nombre_publico:r.clientName||'Cliente',calificacion:Number(r.stars||5),comentario:r.comment||'',aprobada:true,activa:r.active!==false};
    });
    if(rows.length){var res=await client.from('opiniones').upsert(rows,{onConflict:'id'});if(res.error)console.warn('Tapiracuai Supabase opiniones:',res.error.message)}
    await deleteRemoved('opiniones',list,previous);
  }
  async function pushFavorites(list,previous){
    var rows=(list||[]).filter(function(f){return isUuid(f.userId)&&isUuid(f.id)});
    for(var i=0;i<rows.length;i++){
      var f=rows[i], query=client.from('favoritos').select('id').eq('usuario_id',f.userId).limit(1);
      query=f.type==='comercio'?query.eq('comercio_id',f.id).is('producto_id',null):query.eq('producto_id',f.id).is('comercio_id',null);
      var found=await query;
      if(found.error){console.warn('Tapiracuai Supabase favoritos:',found.error.message);continue}
      if(found.data&&found.data.length)continue;
      var res=await client.from('favoritos').insert({usuario_id:f.userId,comercio_id:f.type==='comercio'?f.id:null,producto_id:f.type==='producto'?f.id:null});
      if(res.error)console.warn('Tapiracuai Supabase favoritos:',res.error.message);
    }
    var prev=(previous||[]).filter(function(f){return isUuid(f.userId)&&isUuid(f.id)});
    for(var j=0;j<prev.length;j++){
      var old=prev[j], still=(list||[]).some(function(f){return f.userId===old.userId&&f.type===old.type&&String(f.id)===String(old.id)});
      if(still)continue;
      var del=client.from('favoritos').delete().eq('usuario_id',old.userId);
      del=old.type==='comercio'?del.eq('comercio_id',old.id):del.eq('producto_id',old.id);
      var dres=await del;if(dres.error)console.warn('Tapiracuai Supabase favoritos delete:',dres.error.message);
    }
  }
  async function pushStats(list){
    var rows=(list||[]).filter(function(s){return isUuid(s.businessId)}).map(function(s){return {comercio_id:s.businessId,producto_id:isUuid(s.productId)?s.productId:null,fecha:s.date||new Date().toISOString().slice(0,10),visitas:Number(s.profileViews||0),clicks_whatsapp:Number(s.whatsappClicks||0),apariciones_busqueda:Number(s.searchViews||0),favoritos:Number(s.favorites||0)}})
    for(var i=0;i<rows.length;i++){
      var row=rows[i], q=client.from('estadisticas').select('id').eq('comercio_id',row.comercio_id).eq('fecha',row.fecha).limit(1);
      q=row.producto_id?q.eq('producto_id',row.producto_id):q.is('producto_id',null);
      var found=await q;
      if(found.error){console.warn('Tapiracuai Supabase estadisticas:',found.error.message);continue}
      var res=found.data&&found.data.length?await client.from('estadisticas').update(row).eq('id',found.data[0].id):await client.from('estadisticas').insert(row);
      if(res.error)console.warn('Tapiracuai Supabase estadisticas:',res.error.message);
    }
  }
  async function recordInquiry(data){
    if(!client||!data||!isUuid(data.businessId))return;
    var user=await currentAuthUser();
    var row={comercio_id:data.businessId,producto_id:isUuid(data.productId)?data.productId:null,usuario_id:user&&isUuid(user.id)?user.id:null,nombre_cliente:data.clientName||'',whatsapp_cliente:data.whatsapp||'',mensaje:data.message||'Consulta por WhatsApp desde Tapiracuai',origen:'whatsapp',estado:'new'};
    var res=await client.from('consultas').insert(row);
    if(res.error)console.warn('Tapiracuai Supabase consulta:',res.error.message);
  }
  function updateRequestFromRow(row){
    var meta=row&&row.metadata||{};
    return {id:row.id,businessId:row.comercio_id||meta.businessId||'',businessName:row.nombre||meta.businessName||'',message:row.mensaje||'',status:row.estado||'Pendiente',createdAt:row.created_at,reviewedAt:meta.reviewedAt||''};
  }
  function adminHistoryFromRow(row){
    var meta=row&&row.metadata||{};
    return {id:row.id,businessId:row.comercio_id||meta.businessId||'',businessName:row.nombre||meta.businessName||'',action:meta.action||'',label:meta.label||'',message:row.mensaje||meta.message||'',admin:meta.admin||'',createdAt:row.created_at||meta.createdAt||''};
  }
  async function saveUpdateRequestRecord(request){
    requireClient();
    var row={usuario_id:null,nombre:request.businessName||'',email:'',mensaje:request.message||'',estado:request.status||'Pendiente',comercio_id:request.businessId,tipo:'actualizacion_comercio',metadata:{businessId:request.businessId,businessName:request.businessName||''}};
    var res=await client.from('sugerencias').insert(row).select().single();
    if(res.error)throw res.error;
    var item=updateRequestFromRow(res.data);
    writeCache(STORAGE_KEYS.updateRequests,mergeById(readJson(STORAGE_KEYS.updateRequests,[]),[item]));
    return item;
  }
  async function fetchUpdateRequestsForBusiness(businessId){
    requireClient();
    var res=await client.from('sugerencias').select('*').eq('comercio_id',businessId).eq('tipo','actualizacion_comercio').order('created_at',{ascending:false});
    if(res.error)throw res.error;
    var items=(res.data||[]).map(updateRequestFromRow);
    writeCache(STORAGE_KEYS.updateRequests,mergeById(readJson(STORAGE_KEYS.updateRequests,[]).filter(function(x){return String(x.businessId)!==String(businessId)}),items));
    return items;
  }
  async function markUpdateRequestReviewed(id){
    requireClient();
    var res=await client.from('sugerencias').update({estado:'Revisada',metadata:{reviewedAt:new Date().toISOString()}}).eq('id',id).select().single();
    if(res.error)throw res.error;
    var item=updateRequestFromRow(res.data);
    writeCache(STORAGE_KEYS.updateRequests,readJson(STORAGE_KEYS.updateRequests,[]).map(function(x){return String(x.id)===String(id)?item:x}));
    return item;
  }
  async function saveAdminHistoryRecord(entry){
    requireClient();
    var user=await currentAuthUser();
    if(!user||!isAdminEmail(user.email))throw new Error('Solo el administrador puede registrar historial.');
    var row={usuario_id:null,nombre:entry.businessName||'',email:user.email||'',mensaje:entry.message||'',estado:'Registrada',comercio_id:entry.businessId,tipo:'admin_history',metadata:{businessId:entry.businessId,businessName:entry.businessName||'',action:entry.action||'',label:entry.label||'',admin:entry.admin||user.email||'',createdAt:entry.createdAt||new Date().toISOString()}};
    var res=await client.from('sugerencias').insert(row).select().single();
    if(res.error)throw res.error;
    return adminHistoryFromRow(res.data);
  }
  async function fetchAdminHistoryForBusiness(businessId){
    requireClient();
    var res=await client.from('sugerencias').select('*').eq('comercio_id',businessId).eq('tipo','admin_history').order('created_at',{ascending:false});
    if(res.error)throw res.error;
    return (res.data||[]).map(adminHistoryFromRow);
  }
  async function pushClientProfiles(list){
    var current=await currentAuthUser();
    if(!current)return;
    await ensureUserRole('cliente');
    for(var i=0;i<(list||[]).length;i++){
      var p=list[i]||{};
      if(!isUuid(p.userId)||p.userId!==current.id)continue;
      var fullName=[p.name,p.lastName].filter(Boolean).join(' ').trim();
      var userRes=await client.from('usuarios').update({nombre:fullName||p.name||'',whatsapp:p.phone||'',avatar_url:p.photo||'',direccion:p.address||'',barrio:p.neighborhood||'',ciudad:p.city||'Santaní'}).eq('id',p.userId);
      if(userRes.error)console.warn('Tapiracuai Supabase usuario perfil:',userRes.error.message);
      var clientRes=await client.from('clientes').upsert({usuario_id:p.userId,foto_url:p.photo||'',direccion:p.address||'',barrio:p.neighborhood||'',ciudad:p.city||'Santaní',perfil_completo:p.completed===true},{onConflict:'usuario_id'});
      if(clientRes.error)console.warn('Tapiracuai Supabase cliente perfil:',clientRes.error.message);
      if(clientRes.error)throw clientRes.error;
    }
  }
  function schedulePush(key,nextValue,previousValue){
    if(!client||syncPaused||syncingKeys[key])return;
    syncingKeys[key]=true;
    setTimeout(async function(){
      try{
        var next=JSON.parse(nextValue||'[]');
        var prev=JSON.parse(previousValue||'[]');
        if(key===STORAGE_KEYS.businesses)await pushBusinesses(next,prev);
        if(key===STORAGE_KEYS.products)await pushProducts(next,prev);
        if(key===STORAGE_KEYS.promotions)await pushPromotions(next,prev);
        if(key===STORAGE_KEYS.reviews)await pushReviews(next,prev);
        if(key===STORAGE_KEYS.favorites)await pushFavorites(next,prev);
        if(key===STORAGE_KEYS.stats)await pushStats(next);
        if(key===STORAGE_KEYS.clientProfiles)await pushClientProfiles(next);
      }catch(e){console.warn('Tapiracuai Supabase sync:',e.message)}
      finally{syncingKeys[key]=false}
    },120);
  }
  Storage.prototype.setItem=function(key,value){
    var previous=localStorage.getItem(key);
    rawSetItem.call(this,key,value);
    if([STORAGE_KEYS.businesses,STORAGE_KEYS.products,STORAGE_KEYS.promotions,STORAGE_KEYS.favorites,STORAGE_KEYS.reviews,STORAGE_KEYS.stats,STORAGE_KEYS.clientProfiles].indexOf(key)>-1){
      schedulePush(key,value,previous);
    }
  };

  async function uploadFile(bucket,file,path){
    if(!client||!file)return '';
    var user=await currentAuthUser();
    if(!user)throw new Error('Inicia sesion para subir imagenes.');
    var safeName=String(file.name||'imagen').replace(/[^a-zA-Z0-9._-]+/g,'-');
    var finalPath=path||user.id+'/'+Date.now()+'-'+safeName;
    var res=await client.storage.from(bucket).upload(finalPath,file,{cacheControl:'3600',upsert:true});
    if(res.error)throw res.error;
    return publicUrl(bucket,res.data.path);
  }

  async function saveBusinessRecord(b){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Inicia sesion para guardar el comercio.');
    await ensureUserRole('comercio');
    b=Object.assign({},b||{},{id:user.id,ownerUserId:user.id,email:user.email});
    var row=businessToRow(b,{id:user.id,email:user.email});
    if(!row)throw new Error('No se pudo preparar el comercio para guardar en Supabase.');
    var res=await client.from('comercios').upsert(row,{onConflict:'id'}).select().single();
    if(res.error)throw res.error;
    var item=businessFromRow(res.data);
    if(b.schedule&&b.schedule._needsReview!==true){await saveBusinessSchedule(item.id,b.schedule);item.schedule=b.schedule}
    await ensureCommerceClientProfile({fullName:b.owner||b.responsable||'',whatsapp:b.whatsapp||''});
    var cached=readJson(STORAGE_KEYS.businesses,[]).filter(function(x){return String(x.id)!==String(item.id)&&String(x.ownerUserId)!==String(item.ownerUserId)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.businesses,cached);
    return item;
  }
  async function saveAdminBusinessRecord(b){
    requireClient();
    var user=await currentAuthUser();
    if(!user||!isAdminEmail(user.email))throw new Error('Solo el administrador puede modificar comercios.');
    var row=businessToRow(b,{id:b&&b.ownerUserId,email:b&&b.email});
    if(!row)throw new Error('No se pudo preparar el comercio para guardar en Supabase.');
    var res=await client.from('comercios').upsert(row,{onConflict:'id'}).select().single();
    if(res.error)throw res.error;
    var item=businessFromRow(res.data);
    if(b&&b.schedule&&b.schedule._needsReview!==true){await saveBusinessSchedule(item.id,b.schedule);item.schedule=b.schedule}
    var cached=readJson(STORAGE_KEYS.businesses,[]).filter(function(x){return String(x.id)!==String(item.id)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.businesses,cached);
    dispatch('tapiracuai:data-updated',{source:'admin-business'});
    return item;
  }
  async function saveProductRecord(p){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Inicia sesi?n para guardar productos.');
    var own=await fetchOwnBusiness();
    if(!own){
      throw new Error('No se encontr? un comercio vinculado a este usuario.');
    }
    if(!isUuid(own.id)){
      throw new Error('El comercio no tiene un identificador válido.');
    }
    p=Object.assign({},p||{},{businessId:own.id});
    var payload=productToRow(p);
    if(!payload)throw new Error('El comercio no tiene un identificador válido.');
    var res=await client.from('productos').upsert(payload,{onConflict:'id'}).select().single();
    if(res.error){
      var message=[
        'error.code: '+(res.error.code||''),
        'error.message: '+(res.error.message||''),
        'error.details: '+(res.error.details||''),
        'error.hint: '+(res.error.hint||'')
      ].join(' | ');
      var err=new Error(message);
      err.supabaseError=res.error;
      err.payload=payload;
      err.authUserId=user.id;
      err.commerceId=own.id;
      throw err;
    }
    var item=productFromRow(res.data);
    var cached=readJson(STORAGE_KEYS.products,[]).filter(function(x){return String(x.id)!==String(item.id)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.products,cached);
    return item;
  }
  async function deleteProductRecord(id){
    requireClient();
    if(!isUuid(id))throw new Error('Producto invalido para eliminar.');
    var res=await client.from('productos').delete().eq('id',id);
    if(res.error)throw res.error;
    writeCache(STORAGE_KEYS.products,readJson(STORAGE_KEYS.products,[]).filter(function(x){return String(x.id)!==String(id)}));
    return true;
  }
  async function savePromotionRecord(p){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Inicia sesion para guardar promociones.');
    var own=await fetchOwnBusiness();
    if(!own)throw new Error('No se encontró un comercio vinculado a este usuario.');
    if(!isUuid(own.id))throw new Error('El comercio no tiene un identificador válido.');
    p=Object.assign({},p||{},{businessId:own.id});
    var payload=promoToRow(p);
    if(!payload)throw new Error('El comercio no tiene un identificador válido.');
    var res=await client.from('promociones').upsert(payload,{onConflict:'id'}).select().single();
    if(res.error)throw res.error;
    var item=promoFromRow(res.data);
    var cached=readJson(STORAGE_KEYS.promotions,[]).filter(function(x){return String(x.id)!==String(item.id)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.promotions,cached);
    return item;
  }
  async function deletePromotionRecord(id){
    requireClient();
    if(!isUuid(id))throw new Error('Promocion invalida para eliminar.');
    var res=await client.from('promociones').delete().eq('id',id);
    if(res.error)throw res.error;
    writeCache(STORAGE_KEYS.promotions,readJson(STORAGE_KEYS.promotions,[]).filter(function(x){return String(x.id)!==String(id)}));
    return true;
  }
  async function fetchInfoBanners(){
    if(!BANNERS_ENABLED)return [];
    requireClient();
    var res=await client.from('banners_informativos').select('*').order('created_at',{ascending:false});
    if(res.error)throw res.error;
    var items=(res.data||[]).map(infoBannerFromRow);
    writeCache(STORAGE_KEYS.infoBanners,items);
    dispatch('tapiracuai:banners-updated',{source:'supabase'});
    return items;
  }
  async function saveInfoBannerRecord(b){
    if(!BANNERS_ENABLED)throw new Error('Banners informativos desactivados temporalmente.');
    requireClient();
    var user=await currentAuthUser();
    if(!user||!isAdminEmail(user.email))throw new Error('Solo el administrador puede guardar banners.');
    var row=infoBannerToRow(b,user);
    if(!row)throw new Error('No se pudo preparar el banner.');
    var res=await client.from('banners_informativos').upsert(row,{onConflict:'id'}).select().single();
    if(res.error)throw res.error;
    var item=infoBannerFromRow(res.data);
    writeCache(STORAGE_KEYS.infoBanners,mergeById(readJson(STORAGE_KEYS.infoBanners,[]).filter(function(x){return String(x.id)!==String(item.id)}),[item]).sort(function(a,b){return new Date(b.createdAt||0)-new Date(a.createdAt||0)}));
    dispatch('tapiracuai:banners-updated',{source:'admin'});
    return item;
  }
  async function deleteInfoBannerRecord(id){
    if(!BANNERS_ENABLED)throw new Error('Banners informativos desactivados temporalmente.');
    requireClient();
    var user=await currentAuthUser();
    if(!user||!isAdminEmail(user.email))throw new Error('Solo el administrador puede eliminar banners.');
    if(!isUuid(id))throw new Error('Banner invalido para eliminar.');
    var res=await client.from('banners_informativos').delete().eq('id',id);
    if(res.error)throw res.error;
    writeCache(STORAGE_KEYS.infoBanners,readJson(STORAGE_KEYS.infoBanners,[]).filter(function(x){return String(x.id)!==String(id)}));
    dispatch('tapiracuai:banners-updated',{source:'admin'});
    return true;
  }

  if(client){
    client.auth.onAuthStateChange(function(){hydrateAll()});
    hydrateAll();
  }

  window.TapiracuaiSupabase={
    client:client,
    available:!!client,
    signIn:signIn,
    signUp:signUp,
    signOut:signOut,
    resetPassword:resetPassword,
    hydrateAll:hydrateAll,
    currentAuthUser:currentAuthUser,
    fetchUserProfile:fetchUserProfile,
    fetchOwnBusiness:fetchOwnBusiness,
    createBusinessForUser:createBusinessForUser,
    activateCommerceProfile:activateCommerceProfile,
    ensureUserRole:ensureUserRole,
    ensureCommerceClientProfile:ensureCommerceClientProfile,
    fetchUserRoles:fetchUserRoles,
    uploadFile:uploadFile,
    saveBusinessRecord:saveBusinessRecord,
    saveAdminBusinessRecord:saveAdminBusinessRecord,
    saveProductRecord:saveProductRecord,
    deleteProductRecord:deleteProductRecord,
    savePromotionRecord:savePromotionRecord,
    deletePromotionRecord:deletePromotionRecord,
    fetchInfoBanners:fetchInfoBanners,
    saveInfoBannerRecord:saveInfoBannerRecord,
    deleteInfoBannerRecord:deleteInfoBannerRecord,
    pushClientProfiles:pushClientProfiles,
    pushBusinesses:pushBusinesses,
    pushProducts:pushProducts,
    pushPromotions:pushPromotions,
    pushFavorites:pushFavorites,
    pushReviews:pushReviews,
    pushStats:pushStats,
    recordInquiry:recordInquiry,
    saveUpdateRequestRecord:saveUpdateRequestRecord,
    fetchUpdateRequestsForBusiness:fetchUpdateRequestsForBusiness,
    markUpdateRequestReviewed:markUpdateRequestReviewed,
    saveAdminHistoryRecord:saveAdminHistoryRecord,
    fetchAdminHistoryForBusiness:fetchAdminHistoryForBusiness,
    businessToRow:businessToRow,
    businessFromRow:businessFromRow,
    isUuid:isUuid,
    connectionError:connectionError,
    config:{
      supabaseUrl:cfg.supabaseUrl||'',
      hasPublishableKey:!!cfg.supabaseAnonKey,
      keyPrefix:cfg.supabaseAnonKey?String(cfg.supabaseAnonKey).slice(0,14):''
    }
  };
})();
