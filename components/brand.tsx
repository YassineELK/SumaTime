/* eslint-disable @next/next/no-img-element -- Small local brand assets keep their original rendering. */
export default function Brand() {
  return <span className="sumatoni-brand">
    <img className="sumatoni-mark" src="/brand/sumatoni-mark.png" width="40" height="51" alt="" />
    <span className="sumatoni-brand-copy">
      <img className="sumatoni-wordmark" src="/brand/sumatoni-wordmark.png" width="260" height="30" alt="Sumatoni" />
      <span className="sumatoni-product">TIME</span>
    </span>
  </span>;
}
