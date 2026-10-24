import { describe, expect, it } from 'vitest';
import { baseFretFor, diagramGeometry } from './diagram';
import { getVoicingById } from './library';

function voicing(id: string) {
  const v = getVoicingById(id);
  if (!v) throw new Error(`missing ${id}`);
  return v;
}

describe('diagramGeometry', () => {
  it('draws six strings and fretCount + 1 fret lines', () => {
    const g = diagramGeometry(voicing('v_x32010'));
    expect(g.strings).toHaveLength(6);
    expect(g.frets).toHaveLength(5);
    expect(new Set(g.strings.map((s) => s.x1)).size).toBe(6);
    const ys = g.frets.map((f) => f.y1);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('marks muted and open strings and places dots on the right strings and frets', () => {
    const g = diagramGeometry(voicing('v_x32010'));
    expect(g.markers.map((m) => [m.string, m.kind])).toEqual([
      [0, 'muted'],
      [3, 'open'],
      [5, 'open'],
    ]);
    expect(g.dots.map((d) => [d.string, d.fret, d.finger])).toEqual([
      [1, 3, '3'],
      [2, 2, '2'],
      [4, 1, '1'],
    ]);
    const [a, b] = [g.dots[0], g.dots[1]];
    expect(a && b && a.cy > b.cy).toBe(true); // fret 3 is below fret 2
    expect(g.showNut).toBe(true);
    expect(g.baseFretLabel).toBeNull();
  });

  it('draws a barre spanning its strings and omits the dots it covers', () => {
    const g = diagramGeometry(voicing('v_133211'));
    expect(g.barres).toHaveLength(1);
    const [barre] = g.barres;
    const first = g.strings[0];
    const last = g.strings[5];
    expect(barre && first && last && barre.x < first.x1 && barre.x + barre.width > last.x1).toBe(
      true,
    );
    expect(g.dots.map((d) => [d.string, d.fret])).toEqual([
      [1, 3],
      [2, 3],
      [3, 2],
    ]);
  });

  it('uses a base fret and label for high positions', () => {
    const v = voicing('v_x57775');
    expect(baseFretFor(v)).toBe(5);
    const g = diagramGeometry(v);
    expect(g.baseFret).toBe(5);
    expect(g.showNut).toBe(false);
    expect(g.nut).toBeNull();
    expect(g.baseFretLabel?.text).toBe('5fr');
    for (const dot of g.dots) {
      expect(dot.cy).toBeGreaterThan(g.frets[0]?.y1 ?? 0);
      expect(dot.cy).toBeLessThan(g.frets[4]?.y1 ?? 0);
    }
  });

  it('keeps every element inside the viewBox', () => {
    for (const id of ['v_x32010', 'v_133211', 'v_x57775', 'v_xaccca', 'v_2x0232']) {
      const g = diagramGeometry(voicing(id));
      for (const p of [...g.dots, ...g.markers]) {
        expect(p.cx).toBeGreaterThan(0);
        expect(p.cx).toBeLessThan(g.width);
        expect(p.cy).toBeGreaterThan(0);
        expect(p.cy).toBeLessThan(g.height);
      }
      if (g.baseFretLabel) expect(g.baseFretLabel.x).toBeLessThan(g.width);
    }
  });
});
