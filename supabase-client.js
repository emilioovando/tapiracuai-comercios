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
    clientProfiles:'tapiracuai_client_profiles'
  };
  var BANNERS_ENABLED=true;
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
  function hasOwn(obj,key){return Object.prototype.hasOwnProperty.call(obj||{},key)}
  function validateImageFile(file){
    if(!file)return;
    var allowed=['image/jpeg','image/png','image/webp'];
    var maxBytes=5*1024*1024;
    if(allowed.indexOf(file.type)===-1)throw new Error('Formato de imagen no permitido. Usá JPG, PNG o WebP.');
    if(file.size>maxBytes)throw new Error('La imagen es demasiado pesada. El máximo permitido es 5 MB.');
  }
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
  function scheduleRowsForBusiness(schedule){
    var days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    if(!schedule)return [];
    var rows=[];
    days.forEach(function(day,idx){
      var item=schedule[day]||{},type=item.type||(item.closed===true?'closed':(item.type==='24_hours'?'24_hours':'regular'));
      if(type==='regular'&&Array.isArray(item.periods)&&item.periods.length){item.periods.forEach(function(p){rows.push({dia_semana:idx,abierto:true,abre:p.open||p.openTime,cierra:p.close||p.closeTime})});return}
      rows.push({dia_semana:idx,abierto:type!=='closed',abre:type==='regular'?(item.openTime||item.open||item.abre||'08:00'):null,cierra:type==='regular'?(item.closeTime||item.close||item.cierra||'18:00'):null});
    });
    return rows;
  }
  async function saveBusinessSchedule(comercioId,schedule){
    if(!client||!comercioId||!schedule||schedule._needsReview)return;
    var rows=scheduleRowsForBusiness(schedule);
    var res=await client.rpc('save_my_business_schedule',{p_rows:rows});
    if(res.error)throw res.error;
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
      delivery:meta.delivery===true||(hasOwn(row,'delivery')&&row.delivery===true),
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
    if(hasOwn(b,'delivery'))metadata.delivery=b.delivery===true;
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
  function businessToOwnerUpdateRow(b){
    b=b||{};
    var cats=Array.isArray(b.categories)&&b.categories.length?b.categories:[b.rubro||b.category||'General'];
    var row={
      nombre:b.name||b.nombre||'Mi comercio',
      rubro:b.rubro||cats[0]||'General',
      categorias:cats,
      responsable:b.owner||b.responsable||'',
      whatsapp:b.whatsapp||'',
      direccion:b.address||b.direccion||'',
      latitud:n(b.lat),
      longitud:n(b.lng),
      horario_texto:b.hours||'',
      metodos_pago:Array.isArray(b.paymentMethods)?b.paymentMethods:[],
      descripcion:b.description||'',
      logo_url:b.logo||'',
      portada_url:b.cover||b.portada||'',
      fotos_urls:Array.isArray(b.photos)?b.photos:[]
    };
    if(String(b.barrio||b.neighborhood||'').trim())row.barrio=String(b.barrio||b.neighborhood).trim();
    if(String(b.ciudad||b.city||'').trim())row.ciudad=String(b.ciudad||b.city).trim();
    return row;
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
    return {
      id:row.id,
      businessId:row.comercio_id,
      productId:row.producto_id||'',
      title:row.titulo,
      description:row.descripcion||'',
      discount:row.descuento||'',
      originalPrice:row.precio_original_gs==null?null:row.precio_original_gs,
      offerPrice:row.precio_promocional_gs==null?null:row.precio_promocional_gs,
      start:row.fecha_inicio||'',
      end:row.fecha_fin||'',
      active:row.estado==='active',
      featured:row.destacada===true,
      image:row.imagen_url||'',
      imagePath:row.imagen_path||'',
      metadata:row.metadata||{},
      createdAt:row.created_at,
      updatedAt:row.updated_at
    };
  }
  function promoToRow(p){
    if(!p||!isUuid(p.businessId))return null;
    var id=isUuid(p.id)?p.id:uuid();
    var originalPrice=p.originalPrice===''||p.originalPrice==null?null:normalizePriceValue(p.originalPrice);
    var offerPrice=p.offerPrice===''||p.offerPrice==null?null:normalizePriceValue(p.offerPrice);
    var metadata=Object.assign({},p.metadata||{});
    var payload={id:id,comercio_id:p.businessId,titulo:p.title||'Promoción',descripcion:p.description||'',descuento:p.discount||'',precio_original_gs:originalPrice,precio_promocional_gs:offerPrice,fecha_inicio:p.start||null,fecha_fin:p.end||null,imagen_url:p.image||'',imagen_path:p.imagePath||'',estado:p.active===false?'paused':'active',destacada:p.featured===true,metadata:metadata};
    var productId=p.productId||p.productoId||p.producto_id||'';
    if(isUuid(productId))payload.producto_id=productId;
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
      description:row.texto||row.descripcion||'',
      image:row.imagen_url||'',
      imagePath:row.imagen_path||'',
      buttonText:row.boton_texto||'',
      destinationType:row.destino_tipo||'none',
      destinationValue:row.destino_valor||'',
      startAt:row.fecha_inicio||'',
      endAt:row.fecha_fin||'',
      active:row.activo!==false,
      priority:Number(row.prioridad||0),
      archived:row.archivado===true,
      createdBy:row.created_by||row.creado_por||'',
      createdAt:row.created_at||'',
      updatedAt:row.updated_at||''
    };
  }
  function adminClientFromRow(row){
    row=row||{};
    var reasons=row.motivos_revision||row.review_reasons||[];
    if(typeof reasons==='string'){
      try{reasons=JSON.parse(reasons)}catch(e){reasons=reasons?[reasons]:[]}
    }
    if(!Array.isArray(reasons))reasons=[];
    return {
      userId:row.usuario_id||row.user_id||row.id||'',
      email:normalizeEmail(row.email||''),
      name:row.nombre||row.name||'',
      lastName:row.apellido||row.last_name||'',
      whatsapp:row.whatsapp||row.telefono||'',
      photo:row.foto_url||row.avatar_url||'',
      neighborhood:row.barrio||'',
      city:row.ciudad||'',
      active:row.activo!==false,
      completed:row.perfil_completo===true,
      lastLoginAt:row.last_login_at||'',
      createdAt:row.created_at||'',
      updatedAt:row.updated_at||'',
      inquiriesCount:Number(row.consultas_count||0),
      reviewsCount:Number(row.opiniones_count||0),
      favoritesCount:Number(row.favoritos_count||0),
      requiresReview:row.requiere_revision===true,
      reviewReasons:reasons
    };
  }
  function bannerRpcRow(res){
    var data=res&&res.data;
    if(Array.isArray(data))data=data[0]||null;
    return data?infoBannerFromRow(data):null;
  }
  function bannerPayload(b){
    b=b||{};
    var destinationType=['none','offers','new','delivery','business'].indexOf(b.destinationType)>-1?b.destinationType:'none';
    return {
      p_banner_id:isUuid(b.id)?b.id:null,
      p_titulo:String(b.title||'').trim(),
      p_texto:String(b.description||'').trim(),
      p_imagen_url:b.image||'',
      p_imagen_path:b.imagePath||null,
      p_boton_texto:String(b.buttonText||'').trim()||null,
      p_destino_tipo:destinationType,
      p_destino_valor:destinationType==='business'&&b.destinationValue?String(b.destinationValue):null,
      p_fecha_inicio:b.startAt||null,
      p_fecha_fin:b.endAt||null,
      p_activo:b.active!==false,
      p_prioridad:Math.max(0,Math.min(100,Number(b.priority||0)))
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
  function nullableText(value){return value===undefined||value===null?null:String(value)}
  async function ensureMyClientProfile(params){
    params=params||{};
    var res=await client.rpc('ensure_my_client_profile',{
      p_foto_url:params.foto_url===undefined?null:params.foto_url,
      p_direccion:params.direccion===undefined?null:params.direccion,
      p_barrio:params.barrio===undefined?null:params.barrio,
      p_ciudad:params.ciudad===undefined?null:params.ciudad
    });
    if(res.error)throw res.error;
    return res.data||null;
  }
  function updateClientProfileCache(profile,clientRow){
    var current=[];
    try{current=JSON.parse(localStorage.getItem(STORAGE_KEYS.clientProfiles)||'[]')}catch(e){current=[]}
    var next=current.filter(function(p){return p&&p.userId!==(profile&&profile.id)});
    next.push(clientProfileFromRows(profile,clientRow));
    writeCache(STORAGE_KEYS.clientProfiles,next);
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
    if(!user)throw new Error('Iniciá sesión para activar este perfil.');
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
    if(!user)throw new Error('Iniciá sesión para crear el perfil cliente.');
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
    var clientRowUpdated=await ensureMyClientProfile({
      foto_url:nullableText(clientRow.foto_url||profile.avatar_url||null),
      direccion:nullableText(clientRow.direccion||profile.direccion||null),
      barrio:nullableText(clientRow.barrio||profile.barrio||null),
      ciudad:nullableText(clientRow.ciudad||profile.ciudad||null)
    });
    if(clientRowUpdated)clientRow=clientRowUpdated;
    var roles=await fetchUserRoles(user,profile);
    updateClientProfileCache(profile,clientRow);
    return userFromProfile(profile,roles);
  }
  async function createBusinessForUser(authUser,businessData){
    if(!client||!authUser)return null;
    var existing=await client.from('comercios').select('*').eq('owner_user_id',authUser.id).maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data)return businessFromRow(existing.data);
    businessData=businessData||{};
    var name=businessData.businessName||businessData.name||'Mi comercio';
    var category=businessData.rubro||businessData.category||'General';
    var res=await client.rpc('create_my_comercio',{
      p_nombre:name,
      p_rubro:category,
      p_categorias:[category],
      p_responsable:businessData.responsable||businessData.owner||'',
      p_whatsapp:businessData.whatsapp||'',
      p_email_contacto:normalizeEmail(authUser.email),
      p_direccion:businessData.direccion||businessData.address||'',
      p_barrio:businessData.barrio||businessData.neighborhood||null,
      p_ciudad:businessData.ciudad||businessData.city||null
    });
    if(res.error)throw res.error;
    var configRes=await client.rpc('ensure_my_commerce_config');
    if(configRes.error)throw configRes.error;
    return businessFromRow(res.data);
  }
  async function activateCommerceProfile(businessData){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para activar el comercio.');
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
      if(BANNERS_ENABLED)await fetchActiveBanners();
    }catch(error){console.warn('Tapiracuai Supabase banners:',error&&error.message?error.message:error)}
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
    return;
  }
  async function pushProducts(list,previous){
    return;
  }
  async function pushPromotions(list,previous){
    return;
  }
  async function deleteRemoved(table,next,previous){
    var nextIds={};(next||[]).forEach(function(x){if(isUuid(x&&x.id))nextIds[x.id]=true});
    var removed=(previous||[]).filter(function(x){return isUuid(x&&x.id)&&!nextIds[x.id]}).map(function(x){return x.id});
    if(removed.length){var res=await client.from(table).delete().in('id',removed);if(res.error)console.warn('Tapiracuai Supabase delete '+table+':',res.error.message)}
  }
  async function pushReviews(list,previous){
    var user=await currentAuthUser();
    if(!user)return;
    function ownReview(r){return r&&r.userId===user.id&&isUuid(r.businessId)}
    function normalizeStars(r){
      var stars=Math.round(Number(r.stars||r.rating||5));
      if(!Number.isFinite(stars))stars=5;
      return Math.max(1,Math.min(5,stars));
    }
    function commentOf(r){return String(r.comment||r.message||'').trim()}
    function sameReview(a,b){return a&&b&&String(a.businessId)===String(b.businessId)&&String(a.userId)===String(b.userId)}
    function changedReview(a,b){return !a||normalizeStars(a)!==normalizeStars(b)||commentOf(a)!==commentOf(b)}
    var nextRows=(list||[]).filter(ownReview),prevRows=(previous||[]).filter(ownReview),saved=[];
    for(var i=0;i<nextRows.length;i++){
      var review=nextRows[i],old=prevRows.find(function(item){return sameReview(item,review)});
      if(!changedReview(old,review))continue;
      var res=await client.rpc('save_my_review',{
        p_comercio_id:review.businessId,
        p_calificacion:normalizeStars(review),
        p_comentario:commentOf(review)
      });
      if(res.error){console.warn('Tapiracuai Supabase opiniones:',res.error.message);continue}
      var savedRow=Array.isArray(res.data)?res.data[0]:res.data;
      if(savedRow&&savedRow.id)saved.push(reviewFromRow(savedRow));
    }
    for(var j=0;j<prevRows.length;j++){
      if(nextRows.some(function(item){return sameReview(item,prevRows[j])}))continue;
      if(!isUuid(prevRows[j].id))continue;
      var archived=await client.rpc('archive_my_review',{p_opinion_id:prevRows[j].id});
      if(archived.error)console.warn('Tapiracuai Supabase opiniones:',archived.error.message);
    }
    if(saved.length){
      var cache=readJson(STORAGE_KEYS.reviews,[]);
      saved.forEach(function(item){
        cache=cache.filter(function(existing){return !(sameReview(existing,item)||String(existing.id)===String(item.id))});
        cache.push(item);
      });
      writeCache(STORAGE_KEYS.reviews,cache);
    }
  }
  async function pushFavorites(list,previous){
    var user=await currentAuthUser();
    if(!user)return;
    function validFavorite(f){return f&&f.userId===user.id&&isUuid(f.id)&&(f.type==='comercio'||f.type==='producto')}
    function sameFavorite(a,b){return a&&b&&a.type===b.type&&String(a.id)===String(b.id)}
    async function setFavorite(f,value){
      var res=await client.rpc('set_my_favorite',{
        p_comercio_id:f.type==='comercio'?f.id:null,
        p_producto_id:f.type==='producto'?f.id:null,
        p_favorito:value===true
      });
      if(res.error)console.warn('Tapiracuai Supabase favoritos:',res.error.message);
    }
    var nextRows=(list||[]).filter(validFavorite),prevRows=(previous||[]).filter(validFavorite);
    for(var i=0;i<nextRows.length;i++){
      if(!prevRows.some(function(old){return sameFavorite(old,nextRows[i])}))await setFavorite(nextRows[i],true);
    }
    for(var j=0;j<prevRows.length;j++){
      if(!nextRows.some(function(f){return sameFavorite(f,prevRows[j])}))await setFavorite(prevRows[j],false);
    }
  }
  async function pushStats(){
    return false;
  }
  async function recordStatEvent(businessId,type,productId){
    if(!client||!isUuid(businessId))return false;
    if(['visita','whatsapp','producto'].indexOf(type)===-1)return false;
    var validProductId=isUuid(productId)?productId:null;
    if(type==='producto'&&!validProductId)return false;
    try{
      var res=await client.rpc('registrar_evento_estadistica',{
        p_comercio_id:businessId,
        p_tipo:type,
        p_producto_id:validProductId
      });
      if(res.error){console.warn('Tapiracuai Supabase estadisticas RPC:',res.error.message);return false}
      return res.data===true;
    }catch(error){
      console.warn('Tapiracuai Supabase estadisticas RPC:',error&&error.message?error.message:error);
      return false;
    }
  }
  async function recordInquiry(data){
    if(!client||!data||!isUuid(data.businessId))return;
    var res=await client.rpc('create_my_inquiry',{
      p_comercio_id:data.businessId,
      p_producto_id:isUuid(data.productId)?data.productId:null,
      p_nombre_cliente:data.clientName||'',
      p_whatsapp_cliente:data.whatsapp||'',
      p_mensaje:data.message||'Consulta por WhatsApp desde Tapiracuai'
    });
    if(res.error)console.warn('Tapiracuai Supabase consulta:',res.error.message);
  }
  function inquiryFromRow(row){
    row=row||{};
    return {
      id:row.id||'',
      businessId:row.comercio_id||'',
      productId:row.producto_id||'',
      userId:row.usuario_id||'',
      clientName:row.nombre_cliente||row.client_name||'',
      clientWhatsapp:row.whatsapp_cliente||row.client_whatsapp||'',
      productName:row.producto_nombre||row.nombre_producto||row.product_name||row.producto||'',
      message:row.mensaje||'',
      origin:row.origen||'',
      status:row.estado||'new',
      createdAt:row.created_at||'',
      updatedAt:row.updated_at||''
    };
  }
  async function fetchMyInquiries(){
    requireClient();
    var res=await client.rpc('get_my_inquiries');
    if(res.error)throw res.error;
    return (res.data||[]).map(inquiryFromRow);
  }
  async function setInquiryStatus(id,status){
    requireClient();
    if(!isUuid(id))throw new Error('Consulta inválida.');
    if(['new','opened','answered','archived'].indexOf(status)===-1)throw new Error('Estado de consulta inválido.');
    var res=await client.rpc('set_inquiry_status',{
      p_consulta_id:id,
      p_estado:status
    });
    if(res.error)throw res.error;
    return res.data&&typeof res.data==='object'?inquiryFromRow(res.data):true;
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
    var changed=false;
    for(var i=0;i<(list||[]).length;i++){
      var p=list[i]||{};
      if(!isUuid(p.userId)||p.userId!==current.id)continue;
      var fullName=[p.name,p.lastName].filter(Boolean).join(' ').trim();
      var userRes=await client.from('usuarios').update({nombre:fullName||p.name||'',whatsapp:p.phone||'',avatar_url:p.photo||'',direccion:p.address||'',barrio:p.neighborhood||'',ciudad:p.city||'Santaní'}).eq('id',p.userId);
      if(userRes.error)console.warn('Tapiracuai Supabase usuario perfil:',userRes.error.message);
      var clientRow=await ensureMyClientProfile({
        foto_url:nullableText(p.photo||null),
        direccion:nullableText(p.address||null),
        barrio:nullableText(p.neighborhood||null),
        ciudad:nullableText(p.city||null)
      });
      if(clientRow){
        p.photo=clientRow.foto_url||p.photo||'';
        p.address=clientRow.direccion||p.address||'';
        p.neighborhood=clientRow.barrio||p.neighborhood||'';
        p.city=clientRow.ciudad||p.city||'Santaní';
        p.completed=clientRow.perfil_completo===true;
        changed=true;
      }
    }
    if(changed)writeCache(STORAGE_KEYS.clientProfiles,(list||[]));
  }
  function schedulePush(key,nextValue,previousValue){
    if(!client||syncPaused||syncingKeys[key])return;
    syncingKeys[key]=true;
    setTimeout(async function(){
      try{
        var next=JSON.parse(nextValue||'[]');
        var prev=JSON.parse(previousValue||'[]');
        if(key===STORAGE_KEYS.businesses)await pushBusinesses(next,prev);
        if(key===STORAGE_KEYS.reviews)await pushReviews(next,prev);
        if(key===STORAGE_KEYS.favorites)await pushFavorites(next,prev);
      }catch(e){console.warn('Tapiracuai Supabase sync:',e.message)}
      finally{syncingKeys[key]=false}
    },120);
  }
  Storage.prototype.setItem=function(key,value){
    var previous=localStorage.getItem(key);
    rawSetItem.call(this,key,value);
    if([STORAGE_KEYS.businesses,STORAGE_KEYS.favorites,STORAGE_KEYS.reviews].indexOf(key)>-1){
      schedulePush(key,value,previous);
    }
  };

  async function uploadFile(bucket,file,path){
    if(!client||!file)return '';
    validateImageFile(file);
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para subir imágenes.');
    var safeName=String(file.name||'imagen').replace(/[^a-zA-Z0-9._-]+/g,'-');
    var finalPath=path||user.id+'/'+Date.now()+'-'+safeName;
    var res=await client.storage.from(bucket).upload(finalPath,file,{cacheControl:'3600',upsert:true});
    if(res.error)throw res.error;
    return publicUrl(bucket,res.data.path);
  }

  async function saveBusinessRecord(b){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para guardar el comercio.');
    await ensureUserRole('comercio');
    b=Object.assign({},b||{},{ownerUserId:user.id,email:user.email});
    var own=await client.from('comercios').select('id').eq('owner_user_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(own.error)throw own.error;
    if(!own.data){
      own={data:await createBusinessForUser(user,{businessName:b.name||b.nombre||'Mi comercio',rubro:b.rubro||(b.categories&&b.categories[0])||'General',responsable:b.owner||b.responsable||'',whatsapp:b.whatsapp||'',direccion:b.address||b.direccion||'',barrio:b.barrio||b.neighborhood||null,ciudad:b.ciudad||b.city||null})};
    }
    var row=businessToOwnerUpdateRow(b);
    var res=await client.from('comercios').update(row).eq('id',own.data.id).eq('owner_user_id',user.id).select().single();
    if(res.error)throw res.error;
    var item=businessFromRow(res.data);
    if(hasOwn(b,'delivery')){
      var deliveryRes=await client.rpc('set_my_comercio_delivery',{p_comercio_id:item.id,p_delivery:b.delivery===true});
      if(deliveryRes.error)throw deliveryRes.error;
      item=businessFromRow(deliveryRes.data);
    }
    if(b.schedule&&b.schedule._needsReview!==true){await saveBusinessSchedule(item.id,b.schedule);item.schedule=b.schedule}
    await ensureCommerceClientProfile({fullName:b.owner||b.responsable||'',whatsapp:b.whatsapp||''});
    var cached=readJson(STORAGE_KEYS.businesses,[]).filter(function(x){return String(x.id)!==String(item.id)&&String(x.ownerUserId)!==String(item.ownerUserId)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.businesses,cached);
    return item;
  }
  async function saveAdminBusinessRecord(b,options){
    requireClient();
    var user=await currentAuthUser();
    if(!user||!isAdminEmail(user.email))throw new Error('Solo el administrador puede modificar comercios.');
    options=options||{};
    var action=options.action||'';
    if(['verify','unverify','feature','unfeature','suspend','reactivate'].indexOf(action)===-1)throw new Error('Accion administrativa no permitida.');
    var res=await client.rpc('admin_update_comercio',{
      p_comercio_id:b&&b.id,
      p_action:action,
      p_reason:options.message||b&&b.suspensionReason||null,
      p_admin_notice:b&&b.adminNotice?b.adminNotice:null
    });
    if(res.error)throw res.error;
    var item=businessFromRow(res.data);
    var cached=readJson(STORAGE_KEYS.businesses,[]).filter(function(x){return String(x.id)!==String(item.id)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.businesses,cached);
    dispatch('tapiracuai:data-updated',{source:'admin-business'});
    return item;
  }
  async function saveProductRecord(p){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para guardar productos.');
    p=p||{};
    var categoryId=p.categoryId||p.categoriaId||p.categoria_id||null;
    var stock=p.stock===''||p.stock==null?null:Number(p.stock);
    if(!Number.isFinite(stock))stock=null;
    var res=await client.rpc('save_my_product',{
      p_nombre:p.name||'Producto',
      p_precio_gs:normalizePriceValue(p.price),
      p_producto_id:isUuid(p.id)?p.id:null,
      p_categoria_id:isUuid(categoryId)?categoryId:null,
      p_descripcion:p.description||'',
      p_stock:stock,
      p_disponible:p.available!==false,
      p_activo:p.active!==false,
      p_imagen_url:p.photo||'',
      p_imagen_path:p.imagePath||null,
      p_categoria_nombre:String(p.category||'').trim()||null
    });
    if(res.error){
      var message=[
        'error.code: '+(res.error.code||''),
        'error.message: '+(res.error.message||''),
        'error.details: '+(res.error.details||''),
        'error.hint: '+(res.error.hint||'')
      ].join(' | ');
      var err=new Error(message);
      err.supabaseError=res.error;
      err.payload=null;
      err.authUserId=user.id;
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
    if(!isUuid(id))throw new Error('Producto inválido para archivar.');
    var res=await client.rpc('archive_my_product',{p_producto_id:id});
    if(res.error)throw res.error;
    writeCache(STORAGE_KEYS.products,readJson(STORAGE_KEYS.products,[]).filter(function(x){return String(x.id)!==String(id)}));
    return true;
  }
  async function savePromotionRecord(p){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para guardar promociones.');
    var own=await fetchOwnBusiness();
    if(!own)throw new Error('No se encontró un comercio vinculado a este usuario.');
    if(!isUuid(own.id))throw new Error('El comercio no tiene un identificador válido.');
    p=p||{};
    var productId=p.productId||p.productoId||p.producto_id||null;
    var originalPrice=p.originalPrice===''||p.originalPrice==null?null:normalizePriceValue(p.originalPrice);
    var offerPrice=p.offerPrice===''||p.offerPrice==null?null:normalizePriceValue(p.offerPrice);
    if(originalPrice!=null&&offerPrice!=null&&offerPrice>=originalPrice)throw new Error('El precio oferta debe ser menor al precio anterior.');
    if(p.start&&p.end&&String(p.end)<String(p.start))throw new Error('La fecha de fin no puede ser anterior a la fecha de inicio.');
    var state=p.active===false?'paused':'active';
    var res=await client.rpc('save_my_promotion',{
      p_promocion_id:isUuid(p.id)?p.id:null,
      p_producto_id:isUuid(productId)?productId:null,
      p_titulo:p.title||'Promoción',
      p_descripcion:p.description||'',
      p_descuento:p.discount||'',
      p_precio_original_gs:originalPrice,
      p_precio_promocional_gs:offerPrice,
      p_fecha_inicio:p.start||null,
      p_fecha_fin:p.end||null,
      p_imagen_url:p.image||'',
      p_imagen_path:p.imagePath||null,
      p_estado:state
    });
    if(res.error)throw res.error;
    var item=promoFromRow(res.data);
    var cached=readJson(STORAGE_KEYS.promotions,[]).filter(function(x){return String(x.id)!==String(item.id)});
    cached.unshift(item);
    writeCache(STORAGE_KEYS.promotions,cached);
    return item;
  }
  async function deletePromotionRecord(id){
    requireClient();
    if(!isUuid(id))throw new Error('Promoción inválida para archivar.');
    var res=await client.rpc('archive_my_promotion',{p_promocion_id:id});
    if(res.error)throw res.error;
    writeCache(STORAGE_KEYS.promotions,readJson(STORAGE_KEYS.promotions,[]).filter(function(x){return String(x.id)!==String(id)}));
    return true;
  }
  function jobFromRow(row){
    row=row||{};
    var status=row.estado||row.status||'active';
    return {
      id:row.id||row.job_id||'',
      businessId:row.comercio_id||row.business_id||row.businessId||'',
      businessName:row.comercio_nombre||row.business_name||row.nombre_comercio||row.businessName||'',
      position:row.puesto||row.position||row.titulo||row.title||'Vacante',
      description:row.descripcion||row.description||'',
      requirements:row.requisitos||row.requirements||'',
      image:row.imagen_url||row.image_url||row.image||'',
      imagePath:row.imagen_path||row.image_path||'',
      modality:row.modalidad||row.modality||'Presencial',
      employmentType:row.tipo_empleo||row.employment_type||row.tipo||row.type||'Tiempo completo',
      scheduleText:row.horario||row.horario_texto||row.schedule_text||'',
      address:row.direccion||row.address||'',
      neighborhood:row.barrio||row.neighborhood||'',
      startAt:row.fecha_inicio||row.start_at||row.startAt||'',
      endAt:row.fecha_fin||row.end_at||row.endAt||'',
      status:status,
      active:status==='active'||row.activo===true,
      archived:status==='archived'||row.archivado===true,
      createdAt:row.created_at||row.createdAt||'',
      updatedAt:row.updated_at||row.updatedAt||''
    };
  }
  function jobRpcPayload(data){
    data=data||{};
    var status=data.status||data.estado||(data.active===false?'paused':'active');
    if(['active','paused'].indexOf(status)===-1)status='active';
    function jobModalityValue(value){
      var key=String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[-\s]+/g,'_');
      return {presencial:'presencial',remoto:'remoto',hibrido:'hibrido',hybrid:'hibrido'}[key]||'presencial';
    }
    function jobTypeValue(value){
      var key=String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[-\s]+/g,'_');
      return {tiempo_completo:'tiempo_completo',full_time:'tiempo_completo',medio_tiempo:'medio_tiempo',part_time:'medio_tiempo',temporal:'temporal',por_horas:'por_horas',otro:'otro'}[key]||'tiempo_completo';
    }
    return {
      p_job_id:isUuid(data.id)?data.id:null,
      p_puesto:String(data.position||data.puesto||'').trim(),
      p_descripcion:String(data.description||data.descripcion||'').trim(),
      p_requisitos:String(data.requirements||data.requisitos||'').trim(),
      p_imagen_url:data.image||data.imagen_url||'',
      p_imagen_path:data.imagePath||data.imagen_path||null,
      p_modalidad:jobModalityValue(data.modality||data.modalidad),
      p_tipo_empleo:jobTypeValue(data.employmentType||data.tipo_empleo||data.type),
      p_horario_texto:data.scheduleText||data.horario||'',
      p_direccion:data.address||data.direccion||'',
      p_barrio:data.neighborhood||data.barrio||'',
      p_fecha_inicio:data.startAt||data.fecha_inicio||null,
      p_fecha_fin:data.endAt||data.fecha_fin||null,
      p_estado:status
    };
  }
  async function fetchMyJobs(){
    requireClient();
    var res=await client.rpc('get_my_jobs');
    if(res.error)throw res.error;
    return (Array.isArray(res.data)?res.data:[]).map(jobFromRow);
  }
  async function saveMyJob(data){
    requireClient();
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para guardar empleos.');
    var payload=jobRpcPayload(data);
    if(!payload.p_puesto)throw new Error('Completá el puesto de la vacante.');
    var res=await client.rpc('save_my_job',payload);
    if(res.error)throw res.error;
    return jobFromRow(Array.isArray(res.data)?res.data[0]:res.data);
  }
  async function setMyJobStatus(id,status){
    requireClient();
    if(!isUuid(id))throw new Error('Vacante inválida.');
    if(['active','paused','closed'].indexOf(status)===-1)throw new Error('Estado de vacante inválido.');
    var res=await client.rpc('set_my_job_status',{p_job_id:id,p_estado:status});
    if(res.error)throw res.error;
    return jobFromRow(Array.isArray(res.data)?res.data[0]:res.data);
  }
  async function archiveMyJob(id){
    requireClient();
    if(!isUuid(id))throw new Error('Vacante inválida.');
    var res=await client.rpc('archive_my_job',{p_job_id:id});
    if(res.error)throw res.error;
    return jobFromRow(Array.isArray(res.data)?res.data[0]:res.data);
  }
  async function fetchActiveJobs(){
    requireClient();
    var res=await client.rpc('get_active_jobs');
    if(res.error)throw res.error;
    return (Array.isArray(res.data)?res.data:[]).map(jobFromRow);
  }
  async function fetchBusinessActiveJobs(comercioId){
    requireClient();
    if(!isUuid(comercioId))return [];
    var res=await client.rpc('get_business_active_jobs',{p_comercio_id:comercioId});
    if(res.error)throw res.error;
    return (Array.isArray(res.data)?res.data:[]).map(jobFromRow);
  }
  async function uploadJobImage(file,jobId){
    if(!file)return {url:'',path:''};
    requireClient();
    validateImageFile(file);
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para subir imágenes.');
    var safeName=String(file.name||'vacante').replace(/[^a-zA-Z0-9._-]+/g,'-');
    var folder=isUuid(jobId)?jobId:(uuid()||String(Date.now()));
    var finalPath=user.id+'/'+folder+'/'+Date.now()+'-'+safeName;
    var res=await client.storage.from('job-images').upload(finalPath,file,{cacheControl:'3600',upsert:true});
    if(res.error)throw res.error;
    return {url:publicUrl('job-images',res.data.path),path:res.data.path};
  }
  async function fetchActiveBanner(){
    if(!BANNERS_ENABLED)return null;
    requireClient();
    var res=await client.rpc('get_active_banner');
    if(res.error)throw res.error;
    var item=bannerRpcRow(res);
    dispatch('tapiracuai:banners-updated',{source:'active-banner',banner:item});
    return item;
  }
  async function fetchActiveBanners(){
    if(!BANNERS_ENABLED)return [];
    requireClient();
    var res=await client.rpc('get_active_banners');
    if(res.error)throw res.error;
    var items=(Array.isArray(res.data)?res.data:[]).map(infoBannerFromRow).slice(0,5);
    dispatch('tapiracuai:banners-updated',{source:'active-banners',banners:items});
    return items;
  }
  async function fetchAdminBanners(){
    requireClient();
    var res=await client.rpc('admin_list_banners');
    if(res.error)throw res.error;
    return (Array.isArray(res.data)?res.data:[]).map(infoBannerFromRow);
  }
  async function saveAdminBanner(b){
    requireClient();
    var res=await client.rpc('admin_save_banner',bannerPayload(b));
    if(res.error)throw res.error;
    var item=bannerRpcRow(res);
    dispatch('tapiracuai:banners-updated',{source:'admin-banner',banner:item});
    return item;
  }
  async function setAdminBannerActive(id,active){
    requireClient();
    if(!isUuid(id))throw new Error('Banner inválido.');
    var res=await client.rpc('admin_set_banner_active',{p_banner_id:id,p_activo:active===true});
    if(res.error)throw res.error;
    var item=bannerRpcRow(res);
    dispatch('tapiracuai:banners-updated',{source:'admin-banner-active',banner:item});
    return item;
  }
  async function archiveAdminBanner(id){
    requireClient();
    if(!isUuid(id))throw new Error('Banner inválido.');
    var res=await client.rpc('admin_archive_banner',{p_banner_id:id});
    if(res.error)throw res.error;
    var item=bannerRpcRow(res);
    dispatch('tapiracuai:banners-updated',{source:'admin-banner-archive',banner:item});
    return item||true;
  }
  async function unarchiveAdminBanner(id){
    requireClient();
    if(!isUuid(id))throw new Error('Banner inválido.');
    var res=await client.rpc('admin_unarchive_banner',{p_banner_id:id});
    if(res.error)throw res.error;
    var item=bannerRpcRow(res);
    dispatch('tapiracuai:banners-updated',{source:'admin-banner-unarchive',banner:item});
    return item||true;
  }
  async function deleteAdminBanner(id,imagePath){
    requireClient();
    if(!isUuid(id))throw new Error('Banner inválido.');
    if(imagePath){
      var storage=await client.storage.from('banner-images').remove([String(imagePath)]);
      if(storage.error)throw storage.error;
    }
    var res=await client.rpc('admin_delete_banner',{p_banner_id:id});
    if(res.error)throw res.error;
    dispatch('tapiracuai:banners-updated',{source:'admin-banner-delete',bannerId:id});
    return res.data||true;
  }
  async function uploadBannerImage(file,path){
    if(!file)return '';
    requireClient();
    validateImageFile(file);
    var user=await currentAuthUser();
    if(!user)throw new Error('Iniciá sesión para subir imágenes.');
    var safeName=String(file.name||'banner').replace(/[^a-zA-Z0-9._-]+/g,'-');
    var finalPath=path||'banners/'+(uuid()||Date.now())+'/'+Date.now()+'-'+safeName;
    var res=await client.storage.from('banner-images').upload(finalPath,file,{cacheControl:'3600',upsert:true});
    if(res.error)throw res.error;
    return {url:publicUrl('banner-images',res.data.path),path:res.data.path};
  }
  async function fetchAdminClients(){
    requireClient();
    var res=await client.rpc('admin_list_clients');
    if(res.error)throw res.error;
    return (res.data||[]).map(adminClientFromRow);
  }
  function notificationFromRow(row){
    row=row||{};
    return {
      id:row.id||row.notification_id||'',
      title:row.titulo||row.title||'Notificación',
      message:row.mensaje||row.message||'',
      audience:row.audience||row.audiencia||row.role_target||'all',
      userId:row.user_id||row.usuario_id||'',
      destinationType:row.destino_tipo||row.destination_type||row.destinationType||'none',
      destinationValue:row.destino_valor||row.destination_value||row.destinationValue||'',
      startAt:row.fecha_inicio||row.start_at||row.startAt||'',
      endAt:row.fecha_fin||row.end_at||row.endAt||'',
      active:row.activo!==false&&row.active!==false,
      archived:row.archivado===true||row.archived===true,
      readAt:row.read_at||row.leido_at||row.readAt||'',
      createdAt:row.created_at||row.createdAt||'',
      updatedAt:row.updated_at||row.updatedAt||''
    };
  }
  async function fetchMyNotifications(){
    requireClient();
    var res=await client.rpc('get_my_notifications');
    if(res.error)throw res.error;
    return (Array.isArray(res.data)?res.data:[]).map(notificationFromRow);
  }
  async function fetchMyUnreadNotificationCount(){
    requireClient();
    var res=await client.rpc('get_my_unread_notification_count');
    if(res.error)throw res.error;
    var value=Array.isArray(res.data)?res.data[0]:res.data;
    if(value&&typeof value==='object')value=value.count||value.total||value.unread_count||value.get_my_unread_notification_count||0;
    return Math.max(0,Number(value||0));
  }
  async function markNotificationRead(id){
    requireClient();
    if(!isUuid(id))throw new Error('Notificación inválida.');
    var res=await client.rpc('mark_my_notification_read',{p_notification_id:id});
    if(res.error)throw res.error;
    return true;
  }
  async function markAllNotificationsRead(){
    requireClient();
    var res=await client.rpc('mark_all_my_notifications_read');
    if(res.error)throw res.error;
    return true;
  }
  async function fetchAdminNotifications(){
    requireClient();
    var res=await client.rpc('admin_list_notifications');
    if(res.error)throw res.error;
    return (Array.isArray(res.data)?res.data:[]).map(notificationFromRow);
  }
  async function saveAdminNotification(data){
    requireClient();
    data=data||{};
    var res=await client.rpc('admin_save_notification',{
      p_notification_id:isUuid(data.id)?data.id:null,
      p_titulo:data.title||'',
      p_mensaje:data.message||'',
      p_audience:data.audience||'all',
      p_user_id:isUuid(data.userId)?data.userId:null,
      p_destino_tipo:data.destinationType||'none',
      p_destino_valor:data.destinationValue||null,
      p_fecha_inicio:data.startAt||null,
      p_fecha_fin:data.endAt||null,
      p_activo:data.active===true
    });
    if(res.error)throw res.error;
    return notificationFromRow(Array.isArray(res.data)?res.data[0]:res.data);
  }
  async function archiveAdminNotification(id){
    requireClient();
    if(!isUuid(id))throw new Error('Notificación inválida.');
    var res=await client.rpc('admin_archive_notification',{p_notification_id:id});
    if(res.error)throw res.error;
    return notificationFromRow(Array.isArray(res.data)?res.data[0]:res.data);
  }

  if(client){
    var hydrateTimer=null;
    function requestHydrateAll(){clearTimeout(hydrateTimer);hydrateTimer=setTimeout(hydrateAll,60)}
    client.auth.onAuthStateChange(function(){requestHydrateAll()});
    requestHydrateAll();
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
    fetchMyJobs:fetchMyJobs,
    saveMyJob:saveMyJob,
    setMyJobStatus:setMyJobStatus,
    archiveMyJob:archiveMyJob,
    fetchActiveJobs:fetchActiveJobs,
    fetchBusinessActiveJobs:fetchBusinessActiveJobs,
    uploadJobImage:uploadJobImage,
    fetchActiveBanner:fetchActiveBanner,
    fetchActiveBanners:fetchActiveBanners,
    fetchAdminBanners:fetchAdminBanners,
    saveAdminBanner:saveAdminBanner,
    setAdminBannerActive:setAdminBannerActive,
    archiveAdminBanner:archiveAdminBanner,
    unarchiveAdminBanner:unarchiveAdminBanner,
    deleteAdminBanner:deleteAdminBanner,
    uploadBannerImage:uploadBannerImage,
    fetchAdminClients:fetchAdminClients,
    fetchMyNotifications:fetchMyNotifications,
    fetchMyUnreadNotificationCount:fetchMyUnreadNotificationCount,
    markNotificationRead:markNotificationRead,
    markAllNotificationsRead:markAllNotificationsRead,
    fetchAdminNotifications:fetchAdminNotifications,
    saveAdminNotification:saveAdminNotification,
    archiveAdminNotification:archiveAdminNotification,
    pushClientProfiles:pushClientProfiles,
    pushBusinesses:pushBusinesses,
    pushProducts:pushProducts,
    pushPromotions:pushPromotions,
    pushFavorites:pushFavorites,
    pushReviews:pushReviews,
    pushStats:pushStats,
    recordStatEvent:recordStatEvent,
    recordInquiry:recordInquiry,
    fetchMyInquiries:fetchMyInquiries,
    setInquiryStatus:setInquiryStatus,
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
