'use client';

export function PrintButton() {
  return (
    <button className="btn btn-sm" type="button" onClick={() => window.print()}>
      Print label
    </button>
  );
}
