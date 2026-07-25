// A restrained shower of gallery-coloured confetti — squares of ink, red and
// gold, once, when the exhibition closes. CSS does the falling.

const COLORS = ["#d92b1f", "#121212", "#f0d070", "#1b4a8a", "#3f7a2c"];
const PIECES = 26;

export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 137.5) % 100}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${(i % 9) * 0.14}s`,
            animationDuration: `${2.1 + ((i * 7) % 10) / 9}s`,
          }}
        />
      ))}
    </div>
  );
}
