/* eslint-disable @next/next/no-img-element -- Small local SVG brand asset. */
export default function Brand() {
  return <span className="sumatime-brand">
    <img className="sumatime-mark" src="/brand/sumatime-clock.svg" width="40" height="40" alt="" />
    <span className="sumatime-brand-copy">
      <span className="sumatime-wordmark">Sumatime</span>
      <span className="sumatime-product">PRESTATIONS</span>
    </span>
  </span>;
}
