#!/bin/bash
# resumable: runs each test file in its own pytest process, skips files already done, stops before 150s budget
cd $HOME/mnt/VORA_Robot/backend
OUT=$HOME/vguard/results312; mkdir -p $OUT
start=$(date +%s)
for f in $(ls tests/test_*.py | sort); do
  n=$(basename $f .py)
  [ -f $OUT/$n.done ] && continue
  now=$(date +%s); [ $((now-start)) -gt 100 ] && { echo "budget stop before $n"; exit 0; }
  t0=$(date +%s)
  timeout $((165-(now-start))) env VORA_TEST_DATABASE_URL=sqlite PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=$HOME/vguard \
    $HOME/vt312/bin/python -m pytest -p netguard -p no:cacheprovider -v -rfEs $f > $OUT/$n.txt 2>&1
  rc=$?; t1=$(date +%s)
  if [ $rc -eq 124 ]; then echo "TIMEOUT $n after $((t1-t0))s"; echo $((t1-t0)) > $OUT/$n.timeout; exit 0; fi
  echo "$rc $((t1-t0))s" > $OUT/$n.done; echo "$n rc=$rc $((t1-t0))s $(tail -1 $OUT/$n.txt)"
done
echo ALL_DONE
