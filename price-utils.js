(function(){
  function normalizePrice(value){
    var raw=String(value==null?'':value).trim();
    if(!raw)return 0;
    var digits=raw.replace(/\D/g,'');
    if(!digits)return 0;
    return Math.max(0,parseInt(digits,10)||0);
  }
  function formatPrice(value){
    return 'Gs. '+normalizePrice(value).toLocaleString('es-PY');
  }
  window.TapiracuaiPrice={normalize:normalizePrice,format:formatPrice};
})();
