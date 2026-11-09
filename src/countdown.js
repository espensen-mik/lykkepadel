export function countdown(value){
 const remaining=Math.max(0,new Date(value).getTime()-Date.now());
 if(!Number.isFinite(remaining)||remaining===0)return 'Auktionen er slut';
 const seconds=Math.floor(remaining/1000);
 return `${Math.floor(seconds/86400)}d ${String(Math.floor(seconds/3600)%24).padStart(2,'0')}t ${String(Math.floor(seconds/60)%60).padStart(2,'0')}m ${String(seconds%60).padStart(2,'0')}s`;
}
export function imageCountdown(ends){
 const date=new Date(ends);
 const value=date.toISOString();
 const label=new Intl.DateTimeFormat('da-DK',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Copenhagen'}).format(date);
 return `<div class="image-countdown" title="Slutter ${label} · Dansk tid"><span class="image-countdown-label">Tid tilbage</span><span class="image-countdown-value" data-ends="${value}" role="timer" aria-label="Tid tilbage på auktionen">${countdown(value)}</span></div>`;
}
