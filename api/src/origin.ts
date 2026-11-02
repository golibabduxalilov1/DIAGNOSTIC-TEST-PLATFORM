export function allowedOrigin(actual:string|undefined,expected:string,production:boolean):boolean {
 if(!actual)return false;
 if(actual===expected)return true;
 if(production)return false;
 try {
  const a=new URL(actual),e=new URL(expected);
  const loopback=(host:string)=>host==='localhost'||host==='127.0.0.1';
  return a.origin===actual&&loopback(a.hostname)&&loopback(e.hostname)&&a.protocol===e.protocol&&a.port===e.port;
 }catch{return false;}
}
