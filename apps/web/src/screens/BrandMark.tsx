const SHIELD = "M60 8 L100 22 V58 C100 84 82 102 60 112 C38 102 20 84 20 58 V22 Z";

export const BrandMark = () => (
  <svg className="brand-mark" viewBox="0 0 120 138" role="img" aria-label="EmberWalk, Wildfire Home Check">
    <path d={SHIELD} fill="none" stroke="#3d5a40" strokeWidth="3.2" strokeLinejoin="round" />
    <path d={SHIELD} transform="translate(60 61) scale(0.86) translate(-60 -61)" fill="#5d6f4a" />
    <path d={SHIELD} transform="translate(60 61) scale(0.74) translate(-60 -61)" fill="#3d5a40" />
    <g transform="translate(60 54.5) scale(0.6) translate(-60 -60)">
      <rect x="72" y="34" width="9" height="20" fill="#f7f3e6" />
      <path d="M31 63 L60 31 L89 63 Z" fill="#f7f3e6" stroke="#f7f3e6" strokeWidth="3" strokeLinejoin="round" />
      <rect x="36" y="58" width="48" height="30" fill="#f7f3e6" />
      <rect x="41" y="66" width="9" height="9" fill="#3d5a40" />
      <rect x="70" y="66" width="9" height="9" fill="#3d5a40" />
      <rect x="54" y="68" width="12" height="20" rx="1.5" fill="#3d5a40" />
    </g>
    <text x="60" y="132" textAnchor="middle" fontSize="11" fontWeight="700" textLength="116" lengthAdjust="spacing" fill="#3d5a40">
      WILDFIRE HOME CHECK
    </text>
  </svg>
);
