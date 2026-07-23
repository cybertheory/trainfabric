#!/usr/bin/env python3
import subprocess
import time

TID = "f9d4d906-7268-472b-b1a6-03ca29fb39ed"


def tail(n=40):
    return subprocess.check_output(
        ["clrun", "tail", TID, "--lines", str(n)], text=True, errors="replace"
    )


for i in range(90):
    o = tail(50)
    jobs = [l for l in o.splitlines() if l.startswith("job[")]
    last = jobs[-1] if jobs else "waiting"
    print(f"poll {i}: {last}", flush=True)
    if "DATASET_ID" in o or "job timeout" in o:
        print(o[-3000:])
        break
    if jobs:
        # job[N] status progress error
        parts = last.split(None, 3)
        if len(parts) >= 2 and parts[1] == "error":
            print(o[-3000:])
            break
        if len(parts) >= 2 and parts[1] == "done" and "DATASET_ID" not in o:
            # still running queries
            pass
    time.sleep(8)
else:
    print(tail(60)[-3000:])
