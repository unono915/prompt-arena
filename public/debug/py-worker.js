// 디버그 아레나 — 브라우저 안 파이썬 실행기 (Pyodide, Web Worker)
// 무한 루프가 나도 화면이 멈추지 않도록 워커에서 실행하고, 시간 초과 시 메인 스레드가 워커를 종료한다.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
importScripts(PYODIDE + "pyodide.js");

const HARNESS = `
import sys, io, json, traceback

def __arena_run(code, inp):
    old_in, old_out, old_err = sys.stdin, sys.stdout, sys.stderr
    sys.stdin = io.StringIO(inp if inp.endswith("\\n") else inp + "\\n")
    buf = io.StringIO()
    sys.stdout = buf
    sys.stderr = io.StringIO()
    err = None
    try:
        exec(compile(code, "main.py", "exec"), {"__name__": "__main__"})
    except SystemExit:
        pass
    except BaseException as e:
        line = None
        if isinstance(e, SyntaxError):
            line = e.lineno
            msg = e.msg
        else:
            msg = str(e)
            for fr in traceback.extract_tb(e.__traceback__):
                if fr.filename == "main.py":
                    line = fr.lineno
        err = {"type": type(e).__name__, "msg": msg, "line": line}
    finally:
        sys.stdin, sys.stdout, sys.stderr = old_in, old_out, old_err
    return json.dumps({"stdout": buf.getvalue()[:5000], "error": err}, ensure_ascii=False)
`;

const ready = (async () => {
  const py = await loadPyodide({ indexURL: PYODIDE });
  py.runPython(HARNESS);
  return py;
})();

ready.then(
  () => postMessage({ type: "ready" }),
  (e) => postMessage({ type: "fail", message: String(e && e.message || e) })
);

onmessage = async (ev) => {
  const { id, code, tests } = ev.data;
  const py = await ready;
  const run = py.globals.get("__arena_run");
  for (let i = 0; i < tests.length; i++) {
    const r = JSON.parse(run(code, tests[i].input));
    postMessage({ type: "test", id, index: i, ...r });
  }
  postMessage({ type: "done", id });
};
