export function shortenHex(value: string) {
  return /^0x[\da-f]{40,}$/i.test(value) ? `${value.slice(0, 12)}…${value.slice(-10)}` : value;
}

export function ShortHex({ value }: { value: string }) {
  return (
    <span className="short-hex" title={value}>
      {shortenHex(value)}
    </span>
  );
}
