import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="section" style={{ maxWidth: 560, paddingTop: 40 }}>
      <p className="eyebrow">404</p>
      <h1>That page is not here.</h1>
      <p className="lede">
        The link may be old, or the listing may have been removed after it was returned or expired. Try the board.
      </p>
      <div className="row" style={{ marginTop: 20 }}>
        <Link className="btn" href="/browse">
          Browse the board
        </Link>
        <Link className="btn btn-secondary" href="/">
          Home
        </Link>
      </div>
    </div>
  );
}
