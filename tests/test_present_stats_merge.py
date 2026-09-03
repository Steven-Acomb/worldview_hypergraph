"""present, stats, merge."""

from __future__ import annotations

import copy
import json

from worldview_core import load, merge, present, stats, validate_dict
from worldview_core.cli import main

from conftest import A, S, chain_doc, cycle_doc, doc, write, wv

# ------------------------------------------------------------------ present


def test_present_markdown(example_path):
    w = load(example_path)
    md = present(w, "need-raincoat")
    assert md.startswith("# I should own a good raincoat.\n\n`need-raincoat` · ought\n")
    assert "## The case" in md
    assert "- via `raincoat`: If I am going to walk regularly" in md
    assert "(`exercise-good`, is) — *foundation*" in md
    assert "*see above*" in md
    assert "## Foundations reached" in md and "- `rain-often`:" in md
    assert "## Cycles involved" in md and "`self-knowledge`, `habit-reports`" in md


def test_present_given(example_path):
    w = load(example_path)
    md = present(w, "need-raincoat", given=["walk-commute"])
    assert "Taken as given: `walk-commute`." in md
    assert "(`walk-commute`, ought) — *given*" in md
    assert "walk-for-health" not in md
    assert "## What the audience must grant" in md and "`rain-often`" in md


def test_present_depth_and_zero_premise():
    d = doc([S("a", "A"), S("b", "B")], [A("given", [], ["a"], "stipulated"), A("a-b", ["a"], ["b"], "")])
    md = present(wv(d), "b", depth=1)
    assert "*no premises*" not in md  # a is truncated at depth 1
    assert "*not expanded further*" in md
    assert "(no justification given)" in md
    md = present(wv(d), "b")
    assert "*no premises*" in md


def test_present_cyclic_target(cycle):
    md = present(wv(cycle), "x")
    assert "in cycle: `x`, `y`, `z`" in md
    assert "None: every statement" not in md  # p is a foundation reached
    assert "- `p`: P" in md


# -------------------------------------------------------------------- stats


def test_stats_chain(chain):
    st = stats(wv(chain))
    assert st["statements"] == 6 and st["arguments"] == 3
    assert st["modes"] == {"is": 5, "ought": 1}
    assert st["foundations"] == 4 and st["terminals"] == 1 and st["unused"] == 0
    assert st["cycles"] == 0 and st["longest_chain"] == 2
    assert st["premises"] == {"min": 1, "max": 2, "mean": 1.667}
    assert st["most_supporting"][0] == {"id": "a", "downstream": 2}
    assert st["most_supported"][0] == {"id": "e", "upstream": 5}


def test_stats_cycle(cycle):
    st = stats(wv(cycle))
    assert st["cycles"] == 1 and st["largest_cycle"] == 3 and st["statements_in_cycles"] == 3
    assert st["longest_chain"] == 2  # p -> {x,y,z} -> q
    assert st["ungrounded"] == 0


def test_stats_empty():
    st = stats(wv(doc([], [])))
    assert st["statements"] == 0 and st["longest_chain"] == 0 and st["premises"]["mean"] == 0.0


# -------------------------------------------------------------------- merge


def test_merge_clean():
    base = chain_doc()
    ours = copy.deepcopy(base)
    ours["statements"][0]["text"] = "A (ours)"  # edit a
    ours["statements"].append(S("g", "G"))  # add g
    ours["arguments"].append(A("g-e", ["g"], ["e"], "g gives e"))
    theirs = copy.deepcopy(base)
    theirs["statements"][1]["meta"] = {"role": "axiom"}  # edit b's meta
    theirs["statements"] = [s for s in theirs["statements"] if s["id"] != "f"]  # remove f and its argument
    theirs["arguments"] = [a for a in theirs["arguments"] if a["id"] != "f-e"]
    theirs["name"] = "renamed"

    out = merge(wv(base), wv(ours), wv(theirs))
    assert out["conflicts"] == []
    m = out["merged"]
    assert validate_dict(m) == []
    ids = [s["id"] for s in m["statements"]]
    assert ids == ["a", "b", "c", "d", "e", "g"]
    assert m["statements"][0]["text"] == "A (ours)"
    assert m["statements"][1]["meta"] == {"role": "axiom"}
    assert [a["id"] for a in m["arguments"]] == ["ab-c", "cd-e", "g-e"]
    assert m["name"] == "renamed"
    # a changed on our side, b changed on theirs; c, d, e kept; f removed; g added by us
    assert out["summary"]["statements"] == {"kept": 3, "added_ours": 1, "added_theirs": 0, "added_both": 0, "removed": 1, "changed": 2}
    assert out["summary"]["arguments"] == {"kept": 2, "added_ours": 1, "added_theirs": 0, "added_both": 0, "removed": 1, "changed": 0}


def test_merge_conflicts_and_dangling():
    base = chain_doc()
    ours = copy.deepcopy(base)
    theirs = copy.deepcopy(base)
    ours["statements"][0]["text"] = "A (ours)"
    theirs["statements"][0]["text"] = "A (theirs)"  # both edit a: conflict, ours wins
    ours["statements"] = [s for s in ours["statements"] if s["id"] != "d"]  # ours deletes d
    ours["arguments"] = [a for a in ours["arguments"] if a["id"] != "cd-e"]
    theirs["arguments"].append(A("d-e", ["d"], ["e"], "d alone"))  # theirs uses d: dangling

    out = merge(wv(base), wv(ours), wv(theirs))
    kinds = [(c["kind"], c["id"]) for c in out["conflicts"]]
    assert kinds == [("statement", "a"), ("dangling", "d-e")]
    m = out["merged"]
    assert m["statements"][0]["text"] == "A (ours)"
    assert "d" not in [s["id"] for s in m["statements"]]
    assert [a["id"] for a in m["arguments"]] == ["ab-c", "f-e"]
    assert validate_dict(m) == []


def test_merge_both_add_same_and_different():
    base = chain_doc()
    ours = copy.deepcopy(base)
    theirs = copy.deepcopy(base)
    ours["statements"].append(S("g", "G"))
    theirs["statements"].append(S("g", " G "))  # same content after canon
    ours["statements"].append(S("h", "H ours"))
    theirs["statements"].append(S("h", "H theirs"))  # different: conflict
    out = merge(wv(base), wv(ours), wv(theirs))
    assert [c["id"] for c in out["conflicts"]] == ["h"]
    assert out["summary"]["statements"]["added_both"] == 2
    assert out["merged"]["statements"][-1]["text"] == "H ours"


def test_merge_identity_is_noop(example_path):
    w = load(example_path)
    out = merge(w, w, w)
    assert out["conflicts"] == [] and out["merged"] == w.to_dict()


# ---------------------------------------------------------------------- CLI


def run(capsys, *argv):
    try:
        code = main(list(argv))
    except SystemExit as e:
        code = e.code
    out, err = capsys.readouterr()
    return code, out, err


def test_cli_present(capsys, example_path, tmp_path):
    code, out, _ = run(capsys, "present", str(example_path), "walk-commute", "--given", "commute-30")
    assert code == 0 and out.startswith("# I should walk to work.") and "*given*" in out
    code, out, _ = run(capsys, "--json", "present", str(example_path), "walk-commute")
    assert json.loads(out)["markdown"].startswith("# ")
    target = tmp_path / "case.md"
    code, out, _ = run(capsys, "present", str(example_path), "walk-commute", "-o", str(target))
    assert code == 0 and target.read_text(encoding="utf-8").startswith("# ")
    code, _, err = run(capsys, "present", str(example_path), "nope")
    assert code == 2


def test_cli_stats(capsys, example_path):
    code, out, _ = run(capsys, "stats", str(example_path))
    assert code == 0 and "statements: 12 (8 is, 4 ought)" in out and "cycles: 1" in out
    code, out, _ = run(capsys, "--json", "stats", str(example_path))
    assert json.loads(out)["arguments"] == 6


def test_cli_merge(capsys, tmp_path):
    base = chain_doc()
    ours = copy.deepcopy(base)
    ours["statements"].append(S("g", "G"))
    theirs = copy.deepcopy(base)
    theirs["statements"][0]["text"] = "A (theirs)"
    pb, po, pt = write(tmp_path, "b.json", base), write(tmp_path, "o.json", ours), write(tmp_path, "t.json", theirs)
    out_path = tmp_path / "m.json"
    code, out, _ = run(capsys, "merge", str(pb), str(po), str(pt), "-o", str(out_path))
    assert code == 0 and "no conflicts" in out and out_path.exists()
    merged = json.loads(out_path.read_text(encoding="utf-8"))
    assert merged["statements"][0]["text"] == "A (theirs)" and merged["statements"][-1]["id"] == "g"
    # conflict: exit 1, no file unless --force
    ours["statements"][0]["text"] = "A (ours)"
    po = write(tmp_path, "o2.json", ours)
    out2 = tmp_path / "m2.json"
    code, out, err = run(capsys, "merge", str(pb), str(po), str(pt), "-o", str(out2))
    assert code == 1 and "1 conflict" in out and not out2.exists() and "not writing" in err
    code, out, _ = run(capsys, "--json", "merge", str(pb), str(po), str(pt), "-o", str(out2), "--force")
    assert code == 1 and out2.exists() and json.loads(out)["conflicts"][0]["id"] == "a"
