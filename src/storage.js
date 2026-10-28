// Best times, stars, and level-select unlock, kept in localStorage
// (replaces hiscores.csv / the SQLite db and unlocked.csv).

const KEY = 'vectoria2';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (_) {
    // Private mode or blocked storage: the game still plays, it just forgets.
  }
}

export function getScores() {
  return read().scores || {};
}

// True if `timeS` would beat the stored best time for `level`.
export function isNewBest(level, timeS) {
  const s = getScores()[level];
  return !s || s.time == null || timeS < s.time;
}

// Same rule as save_stats: overwrite if faster OR more stars.
export function saveStats(level, timeS, stars) {
  const data = read();
  data.scores = data.scores || {};
  const old = data.scores[level];
  if (!old || old.time == null || timeS < old.time || stars > (old.stars ?? -1)) {
    data.scores[level] = { time: timeS, stars };
    write(data);
  }
}

export function isLevelSelectUnlocked() {
  return !!read().unlocked;
}

export function unlockLevelSelect() {
  const data = read();
  if (!data.unlocked) {
    data.unlocked = true;
    write(data);
  }
}
