'use client';

import { useId, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const quarters = ['00', '15', '30', '45'];

/** Suggested times use quarter-hours; the text field retains exact typed minutes. */
export default function TimeInput({ label, value, onChange, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState('09');
  const selectedHour = useRef<HTMLButtonElement>(null);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  return <div className="time-input-field">
    <label htmlFor={id}>{label} <span className="required">*</span></label>
    <div className="time-input-control">
      <input id={id} type="text" inputMode="text" required disabled={disabled}
        autoComplete="off" spellCheck={false} placeholder="HH:MM" maxLength={5}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]" title="Heure au format HH:MM, par exemple 09:17"
        value={value} onChange={event => onChange(event.target.value)}
        onBlur={() => { if (/^\d:[0-5]\d$/.test(value)) onChange('0' + value); }} />
      <Popover open={open && !disabled} onOpenChange={next => {
        if (next) setHour(valid ? value.slice(0, 2) : '09');
        setOpen(next);
      }}>
        <PopoverTrigger asChild><button type="button" disabled={disabled} className="time-input-trigger"
          aria-label={`Choisir l’heure de ${label.toLowerCase()} par quart d’heure`}><Clock3 size={18} /></button></PopoverTrigger>
        <PopoverContent className="quarter-picker" align="end" sideOffset={6}
          aria-label={`Heure de ${label.toLowerCase()}`}
          onOpenAutoFocus={event => { event.preventDefault(); selectedHour.current?.focus({ preventScroll: true }); selectedHour.current?.scrollIntoView({ block: 'nearest' }); }}
          onEscapeKeyDown={event => event.stopPropagation()}>
          <p className="quarter-picker-title">Choisir une heure</p>
          <div className="quarter-picker-columns">
            <div><span className="quarter-picker-caption">Heure</span><div className="quarter-picker-hours" role="group" aria-label="Heures">
              {hours.map(item => <button key={item} type="button" ref={item === hour ? selectedHour : undefined}
                aria-pressed={item === hour} onClick={() => setHour(item)}>{item}</button>)}
            </div></div>
            <div><span className="quarter-picker-caption">Minutes</span><div className="quarter-picker-minutes" role="group" aria-label="Quarts d’heure">
              {quarters.map(minute => <button key={minute} type="button" aria-label={`${hour}:${minute}`}
                aria-pressed={value === `${hour}:${minute}`} onClick={() => { onChange(`${hour}:${minute}`); setOpen(false); }}>{minute}</button>)}
            </div></div>
          </div>
          <p className="quarter-picker-hint">Pour une minute précise, saisissez l’heure au clavier.</p>
        </PopoverContent>
      </Popover>
    </div>
  </div>;
}
