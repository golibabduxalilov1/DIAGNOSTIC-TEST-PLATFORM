import { InputError } from "./security";
export type BroadcastUpload={buffer:Buffer;mimetype:string};

export function validateBroadcastMedia(file:BroadcastUpload){
 const b=file.buffer;
 const jpeg=file.mimetype==='image/jpeg'&&b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255;
 const png=file.mimetype==='image/png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const video=file.mimetype==='video/mp4'&&b.length>=12&&b.toString('ascii',4,8)==='ftyp';
 if(!jpeg&&!png&&!video)throw new InputError('JPG, PNG rasm yoki MP4 video tanlang.');
 if(b.length>(video?50:10)*1024*1024)throw new InputError(video?'Video 50 MB dan oshmasin.':'Rasm 10 MB dan oshmasin.');
 return video?'video':'photo';
}
