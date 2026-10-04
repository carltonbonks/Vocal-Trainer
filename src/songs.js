// Song melodies for song mode, as target notes only (no lyrics).
// Each line is one bar: "bar: start+note/length ..." where start and length are
// in sixteenth notes from the start of that bar. A length can run past the bar
// line for tied notes. Phrases start at the bars listed in `phrases`.
// The repo is public: only public-domain melodies (or the user's own) go here.
(function (root) {
  const songs = [];

  // Beethoven, Symphony No. 9 (1824), public domain. The main theme in G major,
  // 4/4, written low (D3 to D4) to sit in a baritone range.
  songs.push({
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    artist: 'Beethoven',
    bpm: 96,
    sections: [
      { name: 'Theme', bar: 1 }, { name: 'Middle', bar: 9 }, { name: 'Theme again', bar: 13 },
    ],
    phrases: [1, 5, 9, 13],
    notes: `
      1: 0B3/4 4B3/4 8C4/4 12D4/4
      2: 0D4/4 4C4/4 8B3/4 12A3/4
      3: 0G3/4 4G3/4 8A3/4 12B3/4
      4: 0B3/6 6A3/2 8A3/8
      5: 0B3/4 4B3/4 8C4/4 12D4/4
      6: 0D4/4 4C4/4 8B3/4 12A3/4
      7: 0G3/4 4G3/4 8A3/4 12B3/4
      8: 0A3/6 6G3/2 8G3/8
      9: 0A3/4 4A3/4 8B3/4 12G3/4
      10: 0A3/4 4B3/2 6C4/2 8B3/4 12G3/4
      11: 0A3/4 4B3/2 6C4/2 8B3/4 12A3/4
      12: 0G3/4 4A3/4 8D3/8
      13: 0B3/4 4B3/4 8C4/4 12D4/4
      14: 0D4/4 4C4/4 8B3/4 12A3/4
      15: 0G3/4 4G3/4 8A3/4 12B3/4
      16: 0A3/6 6G3/2 8G3/8
    `,
  });

  root.VTsongs = songs;
})(typeof window !== 'undefined' ? window : globalThis);
