import './style.css';
import {PreferencesProvider} from './preferences';
export const metadata = { title: 'STEP ONE — Diagnostika', description: 'O‘zingizni yaxshiroq anglash uchun birinchi qadam.' };
export default function Layout({ children }: {children: React.ReactNode}) { return <html lang="uz" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:`try{var p=JSON.parse(localStorage.getItem('stepone-preferences')||'{}');document.documentElement.dataset.theme=p.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p.theme==='light'?'light':'dark';}catch{}`}}/></head><body><PreferencesProvider>{children}</PreferencesProvider></body></html>; }
