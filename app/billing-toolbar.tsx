'use client';
import { useEffect, useRef, useState } from 'react';
import type { Entry } from '@/lib/types';
import { billedMinutes, duration } from '@/lib/business';
import { MAX_BILLING_BATCH, type BillingSelection, type BillingItem } from '@/lib/billing-selection';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export function SelectionCheckbox({ mixed = false, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { mixed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input {...props} ref={ref} type="checkbox" className="billing-checkbox" />;
}
export default function BillingToolbar({ entries, selected, onChange, disabled, filtersPending = false, onConfirm }: { entries: Entry[]; selected: BillingSelection; onChange: (value: BillingSelection) => void; disabled: boolean; filtersPending?: boolean; onConfirm: (items: BillingItem[]) => Promise<void> }) {
  const [review,setReview] = useState<Entry[] | null>(null), [submitting,setSubmitting] = useState(false), [error,setError] = useState('');
  const eligible=entries.filter(e=>!e.billed), chosen=entries.filter(e=>selected[e.id]!==undefined && !e.billed);
  const minutes=chosen.reduce((sum,e)=>sum+billedMinutes(e.start,e.end),0);
  async function confirm() {
    if (!review || submitting) return; setSubmitting(true); setError('');
    try { await onConfirm(review.map(e=>({id:e.id,version:e.version}))); setReview(null); }
    catch(error) { setError((error as Error).message); } finally { setSubmitting(false); }
  }
  return <><div className="billing-toolbar" aria-label="Facturation de la sélection">
    <div><strong>{chosen.length ? `${chosen.length} prestation(s) sélectionnée(s) · ${duration(minutes)}` : 'Facturation en lot'}</strong><p>Sélectionnez des lignes ou toutes les prestations non facturées correspondant aux filtres appliqués.</p></div>
    <div className="billing-toolbar-actions"><button type="button" className="secondary" disabled={disabled || !eligible.length || eligible.length>MAX_BILLING_BATCH} onClick={()=>onChange(Object.fromEntries(eligible.map(e=>[e.id,e.version])))}>Tout sélectionner ({eligible.length})</button><button type="button" className="text-button" disabled={disabled || !chosen.length} onClick={()=>onChange({})}>Effacer la sélection</button><button type="button" className="primary" disabled={disabled || !chosen.length} onClick={()=>{setReview(chosen.map(e=>({...e,version:selected[e.id]})));setError('');}}>Marquer la sélection comme facturée</button></div>
    {filtersPending && <p className="fine" role="status">Appliquez les filtres modifiés avant de sélectionner ou de facturer des prestations.</p>}
    {eligible.length>MAX_BILLING_BATCH && <p className="fine">Réduisez les filtres pour sélectionner au maximum {MAX_BILLING_BATCH} prestations par lot.</p>}
  </div>
  {review && <Dialog open onOpenChange={open=>{if(!open&&!submitting)setReview(null);}}><DialogContent className="billing-confirm-dialog"><DialogTitle>Confirmer le marquage comme facturé</DialogTitle><DialogDescription>{review.length} prestation(s), soit {duration(review.reduce((sum,e)=>sum+billedMinutes(e.start,e.end),0))} facturables, pour {new Set(review.map(e=>e.client_id)).size} client(s). Ces lignes seront verrouillées. Cette action ne crée pas de facture.</DialogDescription>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="billing-confirm-actions"><button type="button" className="secondary" disabled={submitting} onClick={()=>setReview(null)}>Annuler</button><button type="button" className="primary" disabled={submitting} onClick={()=>void confirm()}>{submitting?'Marquage…':`Confirmer ${review.length} prestation(s)`}</button></div>
  </DialogContent></Dialog>}
  </>;
}
