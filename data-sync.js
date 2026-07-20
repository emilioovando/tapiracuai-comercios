// Tapiracuai global data sync - localStorage MVP
(function(){
  var BUSINESS_KEY='tapiracuai_businesses';
  var USERS_KEY='tapiracuai_users';
  var LEGACY_KEY='tapiracuai_comercios';

  function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch(e){return fallback}}
  function writeJson(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function normalizeEmail(email){return String(email||'').trim().toLowerCase()}
  function uid(){return 'biz_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)}
  function categoriesFrom(value){return Array.isArray(value)&&value.length?value:[value&&String(value)||'General']}
  function normalizeBusiness(raw,user){
    raw=Object.assign({},raw||{});
    user=user||{};
    var bd=user.businessData||{};
    var email=normalizeEmail(raw.email||user.email);
    var id=String(raw.id||raw.ownerUserId||user.id||email||uid());
    var ownerUserId=String(raw.ownerUserId||user.id||id);
    var name=raw.name||raw.nombre||bd.businessName||user.name||'Mi comercio';
    var cats=Array.isArray(raw.categories)&&raw.categories.length?raw.categories:categoriesFrom(raw.rubro||raw.category||bd.rubro);
    var rubro=raw.rubro||cats[0]||'General';
    var owner=raw.owner||raw.responsable||bd.responsable||'';
    var address=raw.address||raw.direccion||bd.direccion||'Santaní, Paraguay';
    var cover=raw.cover||raw.portada||'';
    var suspended=raw.suspended===true||raw.estado==='suspended';
    var active=raw.active!==false&&raw.estado!=='inactive'&&!suspended;
    return {
      id:id,
      ownerUserId:ownerUserId,
      email:email,
      name:name,
      nombre:name,
      rubro:rubro,
      categories:cats,
      categoryStatus:raw.categoryStatus||bd.categoryStatus||'aprobada',
      customCategory:raw.customCategory||'',
      owner:owner,
      responsable:owner,
      whatsapp:raw.whatsapp||bd.whatsapp||user.whatsapp||'',
      address:address,
      direccion:address,
      lat:raw.lat||'',
      lng:raw.lng||'',
      hours:raw.hours||'',
      schedule:raw.schedule||raw.horarios||raw.businessHours||raw.openingHours||raw.hoursJson||null,
      scheduleNeedsReview:raw.scheduleNeedsReview===true,
      paymentMethods:Array.isArray(raw.paymentMethods)?raw.paymentMethods:[],
      description:raw.description||'',
      logo:raw.logo||'',
      cover:cover,
      portada:cover,
      photos:Array.isArray(raw.photos)?raw.photos:[],
      verified:raw.verified===true,
      featured:raw.featured===true,
      suspended:suspended,
      active:active,
      estado:suspended?'suspended':(active?'active':'inactive'),
      suspensionReason:raw.suspensionReason||'',
      adminNotice:raw.adminNotice||null,
      createdAt:raw.createdAt||user.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
  }
  function sameBusiness(a,b){
    return String(a.ownerUserId||'')===String(b.ownerUserId||'')||
      String(a.id||'')===String(b.id||'')||
      (a.email&&b.email&&normalizeEmail(a.email)===normalizeEmail(b.email));
  }
  function publishBusiness(raw,user){
    var item=normalizeBusiness(raw,user);
    var list=readJson(BUSINESS_KEY,[]).map(normalizeBusiness).filter(function(b){return !sameBusiness(b,item)});
    list.push(item);
    writeJson(BUSINESS_KEY,list);
    return item;
  }
  function syncFromUsers(){
    readJson(USERS_KEY,[]).forEach(function(user){
      var profiles=Array.isArray(user&&user.profiles)?user.profiles:[];
      if(user&&(user.role==='comercio'||user.businessData||profiles.indexOf('comercio')>-1)){
        publishBusiness({
          id:user.id,
          ownerUserId:user.id,
          email:user.email,
          name:user.businessData&&user.businessData.businessName||user.name,
          rubro:user.businessData&&user.businessData.rubro,
          owner:user.businessData&&user.businessData.responsable,
          whatsapp:user.businessData&&user.businessData.whatsapp||user.whatsapp,
          address:user.businessData&&user.businessData.direccion,
          active:true,
          estado:'active',
          createdAt:user.createdAt
        },user);
      }
    });
  }
  function syncFromLegacy(){
    readJson(LEGACY_KEY,[]).forEach(function(c){
      if(c&&(c.name||c.nombre))publishBusiness({
        id:c.id,
        ownerUserId:c.ownerUserId||c.id,
        email:c.email,
        name:c.name||c.nombre,
        rubro:c.rubro||c.category,
        categories:c.categories,
        owner:c.responsable||c.owner,
        whatsapp:c.whatsapp,
        address:c.direccion||c.address,
        lat:c.lat,
        lng:c.lng,
        logo:c.logo,
        cover:c.cover||c.portada,
        photos:c.photos,
        hours:c.hours,
        paymentMethods:c.paymentMethods,
        description:c.description,
        verified:c.verified,
        featured:c.featured,
        active:c.active!==false&&c.suspended!==true&&c.estado!=='suspended',
        suspended:c.suspended===true||c.estado==='suspended',
        estado:c.suspended===true||c.estado==='suspended'?'suspended':(c.active===false?'inactive':'active'),
        suspensionReason:c.suspensionReason||'',
        createdAt:c.createdAt
      });
    });
  }
  function sync(){
    if(window.TapiracuaiSupabase&&TapiracuaiSupabase.available){
      var cached=readJson(BUSINESS_KEY,[]).map(normalizeBusiness).filter(function(b){return b.id&&b.name});
      writeJson(BUSINESS_KEY,cached);
      return cached;
    }
    syncFromUsers();
    syncFromLegacy();
    var normalized=readJson(BUSINESS_KEY,[]).map(normalizeBusiness).filter(function(b){return b.id&&b.name});
    writeJson(BUSINESS_KEY,normalized);
    return normalized;
  }
  function allBusinesses(){return sync()}

  window.TapiracuaiData={sync:sync,allBusinesses:allBusinesses,publishBusiness:publishBusiness,normalizeBusiness:normalizeBusiness};
  sync();
})();
