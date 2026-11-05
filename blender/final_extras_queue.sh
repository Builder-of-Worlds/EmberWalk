#!/bin/sh
# Waits for the first queue (final_queue.sh, ALL_DONE in $F/queue.log), then renders the hero after scene, the shot 17 aerial and the 12 recheck stills.
# Each step is skipped when its output exists, so a rerun resumes; the first failure stops it. Log: $F/queue2.log.
# Run detached: nohup setsid sh blender/final_extras_queue.sh > /dev/null 2>&1 < /dev/null &
F=${F:-$HOME/WORK/EmberWalk Master/emberwalk-renders/emberwalk-renders-steady-houses/final}
PILE=${PILE:-$F/../pile}
C=${C:-$(cd "$(dirname "$0")/.." && pwd)}
B=${B:-/Applications/Blender.app/Contents/MacOS/Blender}
POLL=${EW_POLL:-60}
Q=$F/queue.log
Q2=$F/queue2.log
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin
BL="--background --factory-startup --python-exit-code 1"

until grep -q '^ALL_DONE' "$Q" 2> /dev/null; do
  if [ -n "${EW_QUEUE_PID:-}" ] && ! kill -0 "$EW_QUEUE_PID" 2> /dev/null; then
    echo "FIRST_QUEUE_GONE $(date '+%H:%M')" >> "$Q2"
    exit 4
  fi
  sleep "$POLL"
done
echo "EXTRAS_START $(date '+%H:%M')" >> "$Q2"

if [ ! -s "$F/after.blend" ]; then
  "$B" $BL "$PILE/hero-after.blend" --python "$C/blender/final_after.py" -- "$C" --spec "$F/spec.json" --out "$F/after.blend" >> "$F/after.log" 2>&1 < /dev/null || { echo "AFTER_FAILED $(date '+%H:%M')" >> "$Q2"; exit 5; }
  echo "AFTER_DONE $(date '+%H:%M')" >> "$Q2"
fi

if [ "${EW_AERIAL:-1}" = "1" ] && [ ! -s "$F/aerial/aerial.png" ]; then
  mkdir -p "$F/aerial"
  "$B" $BL "$F/after.blend" --python "$C/blender/final_aerial.py" -- "$C" "$F/spec.json" "$F/aerial/aerial.png.part" >> "$F/aerial.log" 2>&1 < /dev/null || { echo "AERIAL_FAILED $(date '+%H:%M')" >> "$Q2"; exit 6; }
  mv "$F/aerial/aerial.png.part" "$F/aerial/aerial.png"
  echo "AERIAL_DONE $(date '+%H:%M')" >> "$Q2"
fi

if [ ! -s "$F/recheck/recheck.json" ]; then
  "$B" $BL "$F/after.blend" --python "$C/blender/final_recheck.py" -- "$C" "$F/spec.json" "$C/fixtures/synthetic/hero-after/changes.json" "$F/truth.json" "$F/motion.json" "$F/recheck" >> "$F/recheck.log" 2>&1 < /dev/null || { echo "RECHECK_FAILED $(date '+%H:%M')" >> "$Q2"; exit 7; }
  echo "RECHECK_DONE $(date '+%H:%M')" >> "$Q2"
fi
echo "EXTRAS_DONE $(date '+%H:%M')" >> "$Q2"
