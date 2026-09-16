'use client';
export default function LocationField({ value, onChange, disabled = false }: { value: boolean | null; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="location-field"><label className="onsite-checkbox"><input type="checkbox" checked={value === true} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span>Sur site</span></label>
    <p>{value === null ? 'Mode non renseigné pour cette ancienne prestation.' : value ? 'Intervention dans les locaux du client.' : 'Intervention à distance.'}</p>
    {value === null && !disabled && <button type="button" className="text-button" onClick={() => onChange(false)}>Confirmer à distance</button>}
  </div>;
}
