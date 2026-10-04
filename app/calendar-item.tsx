'use client';
import { useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react';
import { LockKeyhole, GripVertical } from 'lucide-react';
import { adjustedRange, addDays, SLOT_HEIGHT, type CalendarGesture } from '@/lib/calendar';
import { clockTime, duration, billedMinutes, locationLabel } from '@/lib/business';
import type { Entry } from '@/lib/types';
import { ticketBadge } from '@/lib/ticket-selection';
type Change = { date: string; start: number; end: number };
type Drag = Change & { x: number; y: number; scroll: number; mode: CalendarGesture; offsetX: number; active: boolean };
export default function CalendarItem({ entry, lane, lanes, colorStyle, colored, team, disabled, today, onOpen, onChange }: {
 entry: Entry; lane: number; lanes: number; colorStyle: CSSProperties; colored: boolean; team: boolean; disabled: boolean; today: string;
 onOpen: () => void; onChange: (entry: Entry, next: Change) => void;
}) {
 const [drag,setDrag]=useState<Drag|null>(null), current=useRef<Drag|null>(null), blockClick=useRef(0);
 const set=(value:Drag|null)=>{current.current=value;setDrag(value);};
 const locked=!!entry.billed;
 function down(e:PointerEvent<HTMLButtonElement>,mode:CalendarGesture,handle=false){
  if(locked||disabled||e.button!==0||(e.pointerType==='touch'&&!handle))return;
  e.stopPropagation();e.preventDefault();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);
  set({date:entry.date,start:entry.start,end:entry.end,x:e.clientX,y:e.clientY,scroll:e.currentTarget.closest('.calendar-scroll')?.scrollTop||0,mode,offsetX:0,active:false});
 }
 function move(e:PointerEvent<HTMLDivElement>){
  const d=current.current;if(!d)return;
  const panel=e.currentTarget.closest('.calendar-scroll') as HTMLElement;
  const cols=Array.from(panel.querySelectorAll<HTMLElement>('.calendar-day-column'));
  const source=e.currentTarget.closest('.calendar-day-column') as HTMLElement;
  const destination=d.mode==='move'?cols.find(c=>{const box=c.getBoundingClientRect();return box.width>0&&e.clientX>=box.left&&e.clientX<box.right;}):source;
  const date=destination?.dataset.date||d.date;
  if(date>today)return;
  const viewport=panel.getBoundingClientRect();
  if(e.clientY<viewport.top+24)panel.scrollTop-=16;else if(e.clientY>viewport.bottom-24)panel.scrollTop+=16;
  const delta=(e.clientY-d.y+panel.scrollTop-d.scroll)/SLOT_HEIGHT*15;
  const range=adjustedRange(entry.start,entry.end,delta,d.mode);
  set({...d,...range,date,active:d.active||Math.abs(e.clientY-d.y)>5||Math.abs(e.clientX-d.x)>5,offsetX:destination?destination.getBoundingClientRect().left-source.getBoundingClientRect().left:d.offsetX});
 }
 function finish(){const d=current.current;set(null);if(!d?.active)return;blockClick.current=Date.now()+500;if(d.date!==entry.date||d.start!==entry.start||d.end!==entry.end)onChange(entry,{date:d.date,start:d.start,end:d.end});}
 function key(e:KeyboardEvent<HTMLButtonElement>,mode:CalendarGesture){
  if(locked||disabled||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();e.stopPropagation();let date=entry.date;
  if(mode==='move'&&(e.key==='ArrowLeft'||e.key==='ArrowRight'))date=addDays(date,e.key==='ArrowLeft'?-1:1);
  const next=adjustedRange(entry.start,entry.end,e.key==='ArrowUp'?-15:e.key==='ArrowDown'?15:0,mode);
  if(date<=today&&(date!==entry.date||next.start!==entry.start||next.end!==entry.end))onChange(entry,{...next,date});
 }
 const from=drag?.active?drag.start:entry.start,to=drag?.active?drag.end:entry.end;
 return <div className={'calendar-event calendar-interactive'+(colored?' has-client-color':'')+(entry.billed?' is-billed':'')+(to-from<30?' compact-event':to-from<45?' short-event':'')+(drag?.active?' is-dragging':'')}
 style={{...colorStyle,top:from/15*SLOT_HEIGHT,height:Math.max(20,(to-from)/15*SLOT_HEIGHT-2),left:`calc(${lane/lanes*100}% + 3px)`,width:`calc(${100/lanes}% - 6px)`,transform:drag?.active?`translateX(${drag.offsetX}px)`:undefined}}
 onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>set(null)} onLostPointerCapture={()=>set(null)}>
 <button type="button" data-entry-id={entry.id} data-calendar-handle="body" className="calendar-event-body" onPointerDown={e=>down(e,'move')} onClick={()=>{if(Date.now()>blockClick.current)onOpen();}}
 title={`${entry.client} · ${entry.ticket}\n${entry.member} · ${locationLabel(entry.on_site)}\n${clockTime(from)}–${clockTime(to)} · ${duration(billedMinutes(from,to))} facturables`}
 aria-label={`${entry.billed?'Consulter':'Modifier'} ${entry.ticket}, ${entry.client}, ${clockTime(from)} à ${clockTime(to)}`}>
 <span>{!!entry.billed&&<LockKeyhole size={12}/>}{clockTime(from)}–{clockTime(to)}</span><span className="calendar-event-details"><strong>{entry.client}</strong><small>{entry.ticket}{team?' · '+entry.member:''} <span className={`ticket-source ${entry.ticket_source}`}>{ticketBadge(entry.ticket_source)}</span></small></span></button>
 {!locked&&<><button type="button" data-entry-id={entry.id} data-calendar-handle="start" className="calendar-resize-handle start" aria-label={`Ajuster le début de ${entry.ticket}`} title="Début · glisser ou flèches haut/bas" onPointerDown={e=>down(e,'start',true)} onKeyDown={e=>key(e,'start')}/><button type="button" data-entry-id={entry.id} data-calendar-handle="end" className="calendar-resize-handle end" aria-label={`Ajuster la fin de ${entry.ticket}`} title="Fin · glisser ou flèches haut/bas" onPointerDown={e=>down(e,'end',true)} onKeyDown={e=>key(e,'end')}/><button type="button" data-entry-id={entry.id} data-calendar-handle="move" className="calendar-move-handle" aria-label={`Déplacer ${entry.ticket}`} title="Déplacer · glisser ou flèches" onPointerDown={e=>down(e,'move',true)} onKeyDown={e=>key(e,'move')}><GripVertical size={12}/></button></>}
 </div>;
}
