#!/usr/bin/env python3
import subprocess
import time

TID = "e2557993-d609-42e1-b5d0-988ad16f888d"


def tail(n=40):
    return subprocess.check_output(
        ["clrun", "tail", TID, "--lines", str(n)], text=True, errors="replace"
    )


for i in range(120):
    o = tail(50)
    jobs = [l for l in o.splitlines() if l.startswith("job[")]
    last = jobs[-1] if jobs else "-"
    print(f"poll {i}: {last}", flush=True)
    if "DATASET_ID" in o or "job timeout" in o:
        print(o[-4000:])
        break
    if jobs and " error " in last.replace("None", ""):
        # status is error
        parts = last.split()
        if len(parts) >= 2 and parts[1] == "error":
            print(o[-4000:])
            break
    # RuntimeError from script
    if "RuntimeError" in o or "Traceback" in o:
        print(o[-4000:])
        break
    time.sleep(8)
else:
    print(tail(60)[-4000:])
