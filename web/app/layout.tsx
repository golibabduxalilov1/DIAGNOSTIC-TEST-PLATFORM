import './style.css';
import './light.css';
import {PreferencesProvider} from './preferences';
import { connection } from 'next/server';
export async function generateMetadata(){
 try{const response=await fetch(`${process.env.API_URL||'http://127.0.0.1:4000'}/quiz`,{cache:'no-store',signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error();const config=await response.json();return {metadataBase:new URL(process.env.SITE_URL||'https://intizomkalit.uz'),title:config.brand+' — Diagnostika',description:config.description};}catch{return {title:'Diagnostika'};}
}
export default async function Layout({ children }: {children: React.ReactNode}) { await connection(); return <html lang="uz" data-theme="light" suppressHydrationWarning><body><PreferencesProvider>{children}</PreferencesProvider></body></html>; }
