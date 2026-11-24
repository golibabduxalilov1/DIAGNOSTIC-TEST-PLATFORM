'use client';
import type {Config} from './lib';
import TelegramEditor from './telegram-editor';
export default function ResultMessages({config,change}:{config:Config;change:(fn:(c:Config)=>void)=>void}){
 return <section className="panel settings content-settings"><h2>Telegram natija xabarlari</h2><p className="hint">Foizga mos matn natija bilan birga yuboriladi. Xabar ostida PDF va bosma kundalikka buyurtma tugmalari chiqadi. O‘zgarishlardan keyin yuqoridagi saqlash tugmasini bosing.</p>
 {([['low','🔴 0–44% — O‘zgarishni boshlash vaqti keldi'],['medium','🟡 45–74% — Intizomni kuchaytirish kerak'],['good','🟢 75–100% — Intizomingiz yaxshi']] as const).map(([key,label])=><TelegramEditor key={key} label={label} value={config.resultMessages?.[key]||''} onChange={value=>change(c=>{c.resultMessages??={low:'',medium:'',good:''};c.resultMessages[key]=value;})}/>)}
 </section>;
}
