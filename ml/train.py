"""
Delay-risk model pipeline for LandPulse AI — with a champion / challenger gate.

Reads the synthetic acquisition corpus plus any newly recorded milestone
outcomes, trains a baseline and a gradient-boosted challenger with a time-aware
split, compares the challenger with the current champion on the same latest
test window, and — only if it is not worse — refits it on every labelled row,
explains it and publishes every artefact the application serves.

    python ml/train.py [--csv data/land_acquisition_synthetic_350k.csv]
                       [--outcomes data/learning/outcomes.jsonl]
                       [--promote auto|always|never]
                       [--sample 0] [--no-rf] [--shap-rows 0]

Outputs (data/model/, only when promoted — except that a rejected challenger
leaves the champion deployed, so the champion's per-row artefacts are restored
from its archive, or re-derived from its exported trees, if they are absent):
    ensemble.json       the deployed trees (classifier + slip regressor), scored
                        by the API directly — no Python needed at serve time
    metrics.json        split sizes, per-model metrics, curves, calibration, gate
    importance.json     permutation + mean |SHAP| global importance
    surrogate.json      feature spec with training statistics + linear reference
    scores.f32          predicted probability per corpus row, in CSV row order
    delay_days.f32      expected slip days per corpus row
    shap_top.bin        top-K SHAP contributors per row (feature id + value)
    feature-spec.json   the feature contract shared with the API
    registry.json       model versions, gate decisions, champion pointer
    versions/<id>/      archived artefacts of every promoted version (rollback)

Nothing in here is trained on real acquisition records; see README.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import struct
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestClassifier
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    mean_absolute_error,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    precision_recall_curve,
)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
# LANDPULSE_MODEL_DIR lets tests exercise the full publish path without touching the demo model.
MODEL = Path(os.environ["LANDPULSE_MODEL_DIR"]).resolve() if os.environ.get("LANDPULSE_MODEL_DIR") else DATA / "model"
STAGING = MODEL / "staging"
VERSIONS = MODEL / "versions"
REGISTRY = MODEL / "registry.json"
DEFAULT_OUTCOMES = DATA / "learning" / "outcomes.jsonl"

DELAY_THRESHOLD_DAYS = 30
TOP_K_SHAP = 6
KEEP_VERSIONS = 5

# Case-level cut-offs on the predicted probability that one parcel's milestone
# slips by more than 30 days.
RISK_BAND_THRESHOLDS = {"medium": 0.30, "high": 0.55, "critical": 0.80}

# Project-level cut-offs. A project's risk is the expected share of its open
# current-stage parcels whose milestone slips (the mean case probability), which
# is a different quantity from one parcel's probability and sits in a narrower
# range, so it gets its own bands.
PROJECT_RISK_BAND_THRESHOLDS = {"medium": 0.30, "high": 0.45, "critical": 0.60}

# Champion / challenger gate: the challenger is promoted unless it is worse than
# the champion by more than this on the same latest test window.
GATE = {"prAucTolerance": 0.01, "brierTolerance": 0.01}

ARTEFACTS = ["ensemble.json", "metrics.json", "importance.json", "surrogate.json", "feature-spec.json",
             "scores.f32", "delay_days.f32", "shap_top.bin"]

# The per-row artefacts: one value (or top-K SHAP row) per corpus row. scores.f32
# and delay_days.f32 are git-ignored because they are cheap to re-derive from the
# exported trees, so a fresh checkout — a deployment build — starts without them.
ROW_ARTEFACTS = ["scores.f32", "delay_days.f32", "shap_top.bin"]

# ----------------------------------------------------------------- features
# Geography enters only through history (district / authority delay rates), not
# through state one-hots or coordinates: those would tie predictions to the
# demonstration locations and silently mis-score a State / UT, district or
# authority the corpus has never seen.

NUMERIC = [
    "land_area_ha",
    "expected_stage_days",
    "elapsed_stage_days",
    "affected_families",
    "number_of_owners",
    "compensation_pending_days",
    "compensation_completion_percentage",
    "legal_case_count",
    "rr_progress_percentage",
    "rehabilitation_cases",
    "department_response_days",
    "document_completeness",
    "inactivity_days",
    "historical_stage_delay_rate",
    "district_historical_delay_rate",
    "authority_historical_delay_rate",
    "authority_dependency_count",
    "pending_dependency_actions",
    "approval_delay_days",
    "department_coordination_score",
    "project_land_requirement_ha",
]

LOG_NUMERIC = ["inactivity_days", "affected_families", "number_of_owners", "compensation_pending_days", "land_area_ha", "approval_delay_days"]

CATEGORICAL = [
    "project_type",
    "project_priority",
    "land_type",
    "current_stage",
    "ownership_complexity",
    "compensation_status",
    "dispute_complexity",
    "stakeholder_responsiveness",
    "verification_status",
    "approval_status",
    "possession_status",
    "rr_status",
]

BINARY = ["legal_dispute", "rr_required"]

GROUP = {
    "compensation_completion_percentage": "Compensation",
    "compensation_pending_days": "Compensation",
    "compensation_status": "Compensation",
    "comp_pending_frac": "Compensation",
    "legal_case_count": "Legal disputes",
    "legal_dispute": "Legal disputes",
    "dispute_complexity": "Legal disputes",
    "ownership_complexity": "Ownership complexity",
    "number_of_owners": "Ownership complexity",
    "document_completeness": "Documentation & verification",
    "doc_gap_frac": "Documentation & verification",
    "verification_status": "Documentation & verification",
    "approval_status": "Documentation & verification",
    "inactivity_days": "Inactivity",
    "elapsed_stage_days": "Stage schedule pressure",
    "expected_stage_days": "Stage schedule pressure",
    "schedule_consumed": "Stage schedule pressure",
    "current_stage": "Stage schedule pressure",
    "historical_stage_delay_rate": "Historical stage performance",
    "district_historical_delay_rate": "District performance history",
    "authority_historical_delay_rate": "Authority performance history",
    "stakeholder_responsiveness": "Stakeholder responsiveness",
    "department_response_days": "Administrative response time",
    "rr_progress_percentage": "Rehabilitation & resettlement",
    "rr_required": "Rehabilitation & resettlement",
    "rehabilitation_cases": "Rehabilitation & resettlement",
    "rr_status": "Rehabilitation & resettlement",
    "rr_pending_frac": "Rehabilitation & resettlement",
    "affected_families": "Affected families",
    "authority_dependency_count": "Authority dependencies",
    "pending_dependency_actions": "Pending department actions",
    "approval_delay_days": "Approval delay",
    "department_coordination_score": "Inter-department coordination",
    "possession_status": "Possession",
    "land_area_ha": "Parcel & project attributes",
    "land_type": "Parcel & project attributes",
    "project_land_requirement_ha": "Parcel & project attributes",
    "project_type": "Parcel & project attributes",
    "project_priority": "Parcel & project attributes",
}

LABELS = {
    "comp_pending_frac": "Share of compensation still unpaid",
    "doc_gap_frac": "Documentation still to be verified",
    "schedule_consumed": "Stage time consumed vs allowed",
    "rr_pending_frac": "R&R entitlement still pending",
    "compensation_completion_percentage": "Compensation completion %",
    "compensation_pending_days": "Days compensation pending",
    "legal_case_count": "Open legal cases",
    "document_completeness": "Document completeness %",
    "inactivity_days": "Days since last recorded action",
    "elapsed_stage_days": "Days elapsed in current stage",
    "expected_stage_days": "Allowed days for current stage",
    "department_response_days": "Departmental response time",
    "historical_stage_delay_rate": "Historical slip rate of this stage",
    "district_historical_delay_rate": "District historical delay rate",
    "authority_historical_delay_rate": "Authority historical delay rate",
    "affected_families": "Affected families",
    "authority_dependency_count": "Authorities the acquisition depends on",
    "pending_dependency_actions": "Department actions pending on the case",
    "approval_delay_days": "Days an approval / clearance has been pending",
    "department_coordination_score": "Inter-department coordination score",
    "number_of_owners": "Number of recorded owners",
    "rehabilitation_cases": "R&R cases attached",
    "rr_progress_percentage": "R&R progress %",
    "land_area_ha": "Parcel area (ha)",
    "project_land_requirement_ha": "Project land requirement (ha)",
}


def log(msg: str) -> None:
    print(f"[ml] {msg}", flush=True)


def sha256_of(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 22), b""):
            h.update(block)
    return h.hexdigest()


# -------------------------------------------------------------------- data

def load_corpus(csv_path: Path, sample: int) -> pd.DataFrame:
    t0 = time.time()
    usecols = list(dict.fromkeys(
        NUMERIC + CATEGORICAL + BINARY
        + ["case_id", "project_id", "assessment_date", "milestone_due_date", "label_observed",
           "next_milestone_delayed", "delay_risk_category", "actual_stage_delay_days"]
    ))
    df = pd.read_csv(csv_path, usecols=usecols, low_memory=False)
    if sample:
        df = df.iloc[:sample].copy()
    log(f"loaded {len(df):,} rows x {len(df.columns)} cols in {time.time() - t0:.1f}s")
    return df


def apply_outcomes(df: pd.DataFrame, outcomes_path: Path) -> dict:
    """Newly recorded milestone outcomes turn open cases into labelled ones."""
    info = {"file": str(outcomes_path.relative_to(ROOT)) if outcomes_path.exists() else None, "recorded": 0, "applied": 0,
            "delayed": 0, "bySource": {}}
    if not outcomes_path.exists():
        return info
    latest: dict[str, dict] = {}
    with open(outcomes_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("caseId"):
                latest[rec["caseId"]] = rec  # the latest record for a case wins
    info["recorded"] = len(latest)
    if not latest:
        return info
    pos = pd.Series(np.arange(len(df)), index=df["case_id"])
    rows, delayed, days = [], [], []
    for cid, rec in latest.items():
        if cid not in pos.index:
            continue
        rows.append(int(pos[cid]))
        delayed.append(1 if rec.get("delayed") else 0)
        d = rec.get("actualDelayDays")
        days.append(np.nan if d is None else float(d))
        src = rec.get("source", "unknown")
        info["bySource"][src] = info["bySource"].get(src, 0) + 1
    if rows:
        idx = df.index[rows]
        df.loc[idx, "label_observed"] = 1
        df.loc[idx, "next_milestone_delayed"] = delayed
        df.loc[idx, "actual_stage_delay_days"] = days
    info["applied"] = len(rows)
    info["delayed"] = int(sum(delayed))
    return info


def build_spec(df: pd.DataFrame) -> tuple[list[dict], dict]:
    spec: list[dict] = []
    for col in NUMERIC:
        spec.append({"name": col, "op": "identity", "source": col, "group": GROUP.get(col, "Other"), "label": LABELS.get(col, col)})
    for col in LOG_NUMERIC:
        spec.append({"name": f"log_{col}", "op": "log1p", "source": col, "group": GROUP.get(col, "Other"), "label": LABELS.get(col, col)})
    spec.append({"name": "schedule_consumed", "op": "ratio", "source": "elapsed_stage_days", "source2": "expected_stage_days",
                 "group": GROUP["schedule_consumed"], "label": LABELS["schedule_consumed"]})
    spec.append({"name": "comp_pending_frac", "op": "pct_gap", "source": "compensation_completion_percentage", "fill": 0,
                 "group": GROUP["comp_pending_frac"], "label": LABELS["comp_pending_frac"]})
    spec.append({"name": "doc_gap_frac", "op": "pct_gap", "source": "document_completeness",
                 "group": GROUP["doc_gap_frac"], "label": LABELS["doc_gap_frac"]})
    spec.append({"name": "rr_pending_frac", "op": "rr_pending", "source": "rr_progress_percentage", "source2": "rr_required",
                 "group": GROUP["rr_pending_frac"], "label": LABELS["rr_pending_frac"]})
    for col in BINARY:
        spec.append({"name": col, "op": "binary", "source": col, "group": GROUP.get(col, "Other"), "label": col.replace("_", " ").capitalize()})
    cats: dict[str, list[str]] = {}
    for col in CATEGORICAL:
        series = df[col].astype("object").where(df[col].notna(), "(missing)")
        values = sorted(series.unique())
        cats[col] = values
        for value in values[1:]:  # first level is the reference category
            spec.append({"name": f"{col}={value}", "op": "onehot", "source": col, "category": value,
                         "group": GROUP.get(col, "Other"), "label": f"{col.replace('_', ' ').capitalize()}: {value}"})
    return spec, cats


def num(df: pd.DataFrame, col: str) -> np.ndarray:
    if col not in df.columns:
        return np.full(len(df), np.nan)
    return pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=np.float64)


def matrix_from_spec(df: pd.DataFrame, spec: list[dict]) -> np.ndarray:
    """Design matrix for any feature spec — the current one or a champion's."""
    cache_obj: dict[str, np.ndarray] = {}
    out = np.empty((len(df), len(spec)), dtype=np.float64)
    for j, s in enumerate(spec):
        op = s["op"]
        if op == "identity":
            v = num(df, s["source"])
        elif op == "log1p":
            v = np.log1p(np.clip(num(df, s["source"]), 0, None))
        elif op == "ratio":
            v = np.divide(num(df, s["source"]), np.clip(num(df, s["source2"]), 1, None))
        elif op == "pct_gap":
            x = num(df, s["source"])
            fill = s.get("fill")
            if fill is None and s["name"] == "comp_pending_frac":
                fill = 0  # older specs did not carry the fill value
            if fill is not None:
                x = np.nan_to_num(x, nan=float(fill))
            v = (100.0 - x) / 100.0
        elif op == "rr_pending":
            rr = num(df, s["source"])
            req = num(df, s["source2"])
            v = np.where(req > 0, (100.0 - np.nan_to_num(rr, nan=50.0)) / 100.0, 0.0)
        elif op == "binary":
            v = np.nan_to_num(num(df, s["source"]), nan=0.0)
        elif op == "onehot":
            src = s["source"]
            if src not in cache_obj:
                cache_obj[src] = (df[src].astype("object").where(df[src].notna(), "(missing)").to_numpy()
                                  if src in df.columns else np.full(len(df), "(missing)", dtype=object))
            v = (cache_obj[src] == s["category"]).astype(np.float64)
        else:
            raise ValueError(f"unknown op {op}")
        out[:, j] = v
    # Older specs used 'identity' for the binary columns with zero fill.
    for j, s in enumerate(spec):
        if s["op"] == "identity" and s["source"] in BINARY:
            out[:, j] = np.nan_to_num(out[:, j], nan=0.0)
    return out


# ------------------------------------------------------------ tree export

def export_trees(model, n_features: int) -> dict:
    trees = []
    for predictors in model._predictors:
        for p in predictors:
            n = p.nodes
            trees.append({
                "f": [int(v) for v in n["feature_idx"]],
                "t": [float(np.clip(v, -1.7976931348623157e308, 1.7976931348623157e308)) for v in n["num_threshold"]],  # +inf = "all present values go left"; JSON has no Infinity
                "m": [int(v) for v in n["missing_go_to_left"]],
                "l": [int(v) for v in n["left"]],
                "r": [int(v) for v in n["right"]],
                "leaf": [int(v) for v in n["is_leaf"]],
                "v": [float(v) for v in n["value"]],
                "c": [float(v) for v in n["count"]],
            })
    return {"baseline": float(np.ravel(model._baseline_prediction)[0]), "nFeatures": n_features, "trees": trees}


def predict_raw(ens: dict, X: np.ndarray) -> np.ndarray:
    """Vectorised traversal of exported trees; mirrors server/lib/ensemble.mjs."""
    raw = np.full(len(X), ens["baseline"], dtype=np.float64)
    rows = np.arange(len(X))
    for t in ens["trees"]:
        f = np.asarray(t["f"]); thr = np.asarray(t["t"]); ml = np.asarray(t["m"]).astype(bool)
        left = np.asarray(t["l"]); right = np.asarray(t["r"]); leaf = np.asarray(t["leaf"]).astype(bool); val = np.asarray(t["v"])
        node = np.zeros(len(X), dtype=np.int64)
        while True:
            active = ~leaf[node]
            if not active.any():
                break
            a = node[active]
            x = X[rows[active], f[a]]
            go_left = np.where(np.isnan(x), ml[a], x <= thr[a])
            node[active] = np.where(go_left, left[a], right[a])
        raw += val[node]
    return raw


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


# ------------------------------------------------- champion rehydration

def score_corpus_with(model: dict, df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Per-row probability and expected slip from a published model's own trees.

    ensemble.json carries the feature spec it was fitted with and is parity
    checked against scikit-learn to 1e-6 before publication, so this reproduces
    the scores.f32 / delay_days.f32 that model published — the same numbers the
    API serves for those rows — without refitting anything.
    """
    Xc = matrix_from_spec(df, model["features"])
    n = len(Xc)
    scores = np.zeros(n, dtype=np.float32)
    delay_days = np.zeros(n, dtype=np.float32)
    slip = model.get("slip")
    step = 50000
    for s in range(0, n, step):
        chunk = Xc[s: s + step]
        p = sigmoid(predict_raw(model["classifier"], chunk)).astype(np.float32)
        scores[s: s + step] = p
        if slip:
            cond = np.clip(predict_raw(slip, chunk), slip.get("floor", DELAY_THRESHOLD_DAYS + 1), slip.get("cap", 400))
            delay_days[s: s + step] = (p * cond).astype(np.float32)
    return scores, delay_days


def keep_champion_servable(df: pd.DataFrame, champ: dict | None, registry: dict, sampled: bool) -> None:
    """A rejected challenger leaves the champion deployed, so the champion is
    what has to be servable, and that takes more than ensemble.json:
    scripts/build-store.mjs needs its per-row artefacts to build the case store,
    and a rollback needs it archived. Both are derived and git-ignored, so a
    fresh checkout — a deployment build — has neither. Restore them from the
    champion's archive when it is there, re-derive the per-row artefacts from
    the published ensemble otherwise, and archive the champion if it is not.
    """
    if not (MODEL / "ensemble.json").exists():
        return  # nothing is published yet; there is no champion to keep servable
    champion_id = registry.get("champion")
    missing = [name for name in ROW_ARTEFACTS if not (MODEL / name).exists()]

    if champion_id and missing:
        archive = VERSIONS / champion_id
        for name in list(missing):
            if (archive / name).exists():
                shutil.copy2(archive / name, MODEL / name)
                missing.remove(name)
                log(f"restored {name} from the archive of champion {champion_id}")

    if [name for name in missing if name.endswith(".f32")]:
        if sampled:
            log(f"the champion's per-row artefacts are missing, but --sample loaded only {len(df):,} rows; "
                "re-run without --sample so they cover the whole corpus")
        else:
            if champ is None:
                champ = json.loads((MODEL / "ensemble.json").read_text(encoding="utf-8"))
            log(f"re-deriving the champion's per-row artefacts from its exported trees ({len(df):,} rows)…")
            t0 = time.time()
            scores, delay_days = score_corpus_with(champ, df)
            (MODEL / "scores.f32").write_bytes(scores.tobytes())
            (MODEL / "delay_days.f32").write_bytes(delay_days.tobytes())
            for name in ("scores.f32", "delay_days.f32"):
                if name in missing:
                    missing.remove(name)
            log(f"  scores.f32 + delay_days.f32 rebuilt in {time.time() - t0:.1f}s · mean probability {float(scores.mean()):.4f}")

    if "shap_top.bin" in missing:
        log("  shap_top.bin is not recoverable from exported trees; precomputed contributor attribution "
            "stays unavailable until the champion is republished from a full training run")

    # Archive the champion so a rollback has a version to return to: a fresh
    # checkout has no versions/ at all. startRollback copies whatever it finds in
    # an archive, so a partial one would restore a model whose per-row artefacts
    # belong to a different version — only a complete set is worth writing.
    if champion_id:
        archive = VERSIONS / champion_id
        have = [name for name in ARTEFACTS if (MODEL / name).exists()]
        if len(have) < len(ARTEFACTS):
            if not archive.exists():
                log(f"champion {champion_id} is not archived for rollback; "
                    f"{', '.join(name for name in ARTEFACTS if name not in have)} missing")
        elif added := [name for name in have if not (archive / name).exists()]:
            archive.mkdir(parents=True, exist_ok=True)
            for name in added:
                shutil.copy2(MODEL / name, archive / name)
            for v in registry["versions"]:
                if v["id"] == champion_id:
                    v["archived"] = True
            save_registry(registry)
            log(f"archived champion {champion_id} for rollback ({len(added)} artefacts)")


# ----------------------------------------------------------------- metrics

def metrics_at(y_true, prob, threshold: float) -> dict:
    pred = (prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "threshold": round(float(threshold), 4),
        "precision": round(float(precision_score(y_true, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, pred, zero_division=0)), 4),
        "accuracy": round(float((tp + tn) / max(1, tp + tn + fp + fn)), 4),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def evaluate(name: str, y_true, prob, threshold: float) -> dict:
    return {
        "model": name,
        "rocAuc": round(float(roc_auc_score(y_true, prob)), 4),
        "prAuc": round(float(average_precision_score(y_true, prob)), 4),
        "brier": round(float(brier_score_loss(y_true, prob)), 4),
        "positiveRate": round(float(np.mean(y_true)), 4),
        "at_threshold": metrics_at(y_true, prob, threshold),
        "at_half": metrics_at(y_true, prob, 0.5),
    }


def best_f1_threshold(y_true, prob) -> float:
    precision, recall, thresholds = precision_recall_curve(y_true, prob)
    f1 = np.divide(2 * precision * recall, precision + recall, out=np.zeros_like(precision), where=(precision + recall) > 0)
    idx = int(np.nanargmax(f1[:-1])) if len(thresholds) else 0
    return float(thresholds[idx]) if len(thresholds) else 0.5


def curve_points(y_true, prob, n=60) -> dict:
    fpr, tpr, _ = roc_curve(y_true, prob)
    pr_p, pr_r, _ = precision_recall_curve(y_true, prob)
    take = lambda a: [round(float(v), 4) for v in np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(a)), a)]
    return {"roc": {"fpr": take(fpr), "tpr": take(tpr)}, "pr": {"recall": take(pr_r[::-1]), "precision": take(pr_p[::-1])}}


def calibration_bins(y_true, prob, bins=10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(prob, edges) - 1, 0, bins - 1)
    out = []
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        out.append({"bin": f"{edges[b]:.1f}-{edges[b + 1]:.1f}", "predicted": round(float(prob[m].mean()), 4),
                    "observed": round(float(y_true[m].mean()), 4), "count": int(m.sum())})
    return out


def slice_metrics(df: pd.DataFrame, idx: np.ndarray, y, prob, threshold: float, column: str, min_rows=300) -> list[dict]:
    """Per-group test metrics, so weak project types or stages are visible."""
    out = []
    groups = df[column].to_numpy()[idx]
    for g in sorted(pd.unique(groups)):
        m = groups == g
        if m.sum() < min_rows or len(np.unique(y[m])) < 2:
            continue
        pred = (prob[m] >= threshold).astype(int)
        out.append({"group": str(g), "rows": int(m.sum()), "positiveRate": round(float(y[m].mean()), 4),
                    "rocAuc": round(float(roc_auc_score(y[m], prob[m])), 4),
                    "recall": round(float(recall_score(y[m], pred, zero_division=0)), 4),
                    "precision": round(float(precision_score(y[m], pred, zero_division=0)), 4),
                    "meanPredicted": round(float(prob[m].mean()), 4)})
    return out


# ---------------------------------------------------------------- registry

def load_registry() -> dict:
    if REGISTRY.exists():
        try:
            return json.loads(REGISTRY.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"champion": None, "versions": []}


def save_registry(reg: dict) -> None:
    REGISTRY.write_text(json.dumps(reg, indent=1), encoding="utf-8")


def gbm_params(**over):
    base = dict(max_iter=400, learning_rate=0.07, max_leaf_nodes=31, min_samples_leaf=60, l2_regularization=1.0,
                early_stopping=True, validation_fraction=0.12, n_iter_no_change=25, random_state=17)
    base.update(over)
    return base


def slip_params(**over):
    base = dict(loss="absolute_error", max_iter=300, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=80,
                l2_regularization=1.0, early_stopping=True, validation_fraction=0.12, n_iter_no_change=20, random_state=17)
    base.update(over)
    return base


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(DATA / "land_acquisition_synthetic_350k.csv"))
    ap.add_argument("--outcomes", default=str(DEFAULT_OUTCOMES))
    ap.add_argument("--promote", choices=["auto", "always", "never"], default="auto")
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--no-rf", action="store_true")
    ap.add_argument("--shap-rows", type=int, default=0)
    ap.add_argument("--triggered-by", default="cli")
    args = ap.parse_args()

    MODEL.mkdir(parents=True, exist_ok=True)
    if STAGING.exists():
        shutil.rmtree(STAGING)
    STAGING.mkdir(parents=True)
    t_start = time.time()
    version_id = time.strftime("v%Y%m%d-%H%M%S", time.gmtime())
    registry = load_registry()

    csv_path = Path(args.csv)
    outcomes_path = Path(args.outcomes)
    df = load_corpus(csv_path, args.sample)
    n_rows = len(df)
    outcome_info = apply_outcomes(df, outcomes_path)
    if outcome_info["applied"]:
        log(f"applied {outcome_info['applied']:,} newly recorded outcomes ({outcome_info['delayed']:,} delayed)")

    spec, cats = build_spec(df)
    names = [s["name"] for s in spec]
    X = matrix_from_spec(df, spec)
    log(f"design matrix {X.shape[0]:,} x {X.shape[1]}")

    observed = df["label_observed"].to_numpy() == 1
    y = np.nan_to_num(pd.to_numeric(df["next_milestone_delayed"], errors="coerce").to_numpy(), nan=0.0).astype(np.int8)
    dates = pd.to_datetime(df["assessment_date"]).to_numpy()

    # -------------------------------------------------- time-aware split
    obs_idx = np.flatnonzero(observed)
    obs_sorted = obs_idx[np.argsort(dates[obs_idx], kind="stable")]
    n_obs = len(obs_sorted)
    tr, va, te = obs_sorted[: int(n_obs * 0.70)], obs_sorted[int(n_obs * 0.70): int(n_obs * 0.85)], obs_sorted[int(n_obs * 0.85):]
    span = lambda ix: {"rows": int(len(ix)), "from": str(pd.Timestamp(dates[ix].min()).date()), "to": str(pd.Timestamp(dates[ix].max()).date())}
    split_info = {"strategy": "time-aware split on assessment_date (no shuffling)", "observedRows": int(n_obs),
                  "openRows": int(n_rows - n_obs), "train": span(tr), "validation": span(va), "test": span(te)}
    log(f"split train={len(tr):,} val={len(va):,} test={len(te):,}")
    Xtr, ytr, Xva, yva, Xte, yte = X[tr], y[tr], X[va], y[va], X[te], y[te]

    # ---------------------------------------------------------- baseline
    med = np.nanmedian(Xtr, axis=0)
    med = np.where(np.isnan(med), 0.0, med)

    def impute(M):
        out = M.copy()
        bad = np.isnan(out)
        if bad.any():
            out[bad] = np.take(med, np.where(bad)[1])
        return out

    Xtr_i, Xva_i, Xte_i = impute(Xtr), impute(Xva), impute(Xte)
    mu = Xtr_i.mean(axis=0)
    sd = Xtr_i.std(axis=0)
    sd[sd < 1e-9] = 1.0

    log("training logistic-regression baseline…")
    lr = LogisticRegression(max_iter=400, C=1.0, solver="lbfgs")
    lr.fit((Xtr_i - mu) / sd, ytr)
    lr_va = lr.predict_proba((Xva_i - mu) / sd)[:, 1]
    lr_te = lr.predict_proba((Xte_i - mu) / sd)[:, 1]

    # ------------------------------------------- challenger (evaluation fit)
    log("training gradient-boosted challenger on the training window…")
    t0 = time.time()
    gbm = HistGradientBoostingClassifier(**gbm_params())
    gbm.fit(Xtr, ytr)
    gbm_va = gbm.predict_proba(Xva)[:, 1]
    gbm_te = gbm.predict_proba(Xte)[:, 1]
    log(f"  done in {time.time() - t0:.1f}s ({gbm.n_iter_} iters)  val ROC-AUC {roc_auc_score(yva, gbm_va):.4f}")

    thr_lr = best_f1_threshold(yva, lr_va)
    thr_gbm = best_f1_threshold(yva, gbm_va)
    models = {
        "logistic_regression": {"label": "Logistic Regression (baseline)",
                                "validation": evaluate("logistic_regression", yva, lr_va, thr_lr),
                                "test": evaluate("logistic_regression", yte, lr_te, thr_lr)},
        "gradient_boosting": {"label": "Histogram Gradient Boosting (deployed)", "iterations": int(gbm.n_iter_),
                              "validation": evaluate("gradient_boosting", yva, gbm_va, thr_gbm),
                              "test": evaluate("gradient_boosting", yte, gbm_te, thr_gbm)},
    }
    if not args.no_rf:
        log("training random-forest comparison…")
        rf = RandomForestClassifier(n_estimators=140, max_depth=18, min_samples_leaf=12, n_jobs=-1, random_state=17)
        rf.fit(Xtr_i, ytr)
        rf_va = rf.predict_proba(Xva_i)[:, 1]
        rf_te = rf.predict_proba(Xte_i)[:, 1]
        thr_rf = best_f1_threshold(yva, rf_va)
        models["random_forest"] = {"label": "Random Forest (comparison)",
                                   "validation": evaluate("random_forest", yva, rf_va, thr_rf),
                                   "test": evaluate("random_forest", yte, rf_te, thr_rf)}

    # ------------------------------------------------ champion comparison
    champion_file = MODEL / "ensemble.json"
    challenger_test = models["gradient_boosting"]["test"]
    gate = {"tolerance": GATE, "challenger": {k: challenger_test[k] for k in ("rocAuc", "prAuc", "brier")},
            "testWindow": split_info["test"]}
    champion_meta = None
    champion_model = None
    if champion_file.exists():
        try:
            champ = json.loads(champion_file.read_text(encoding="utf-8"))
            champion_model = champ
            champ_spec = champ["features"]
            Xc = matrix_from_spec(df.iloc[te], champ_spec)
            champ_prob = sigmoid(predict_raw(champ["classifier"], Xc))
            champ_eval = evaluate("champion", yte, champ_prob, champ.get("operatingThreshold", thr_gbm))
            champion_meta = {"version": champ.get("version"), **{k: champ_eval[k] for k in ("rocAuc", "prAuc", "brier")}}
            gate["champion"] = champion_meta
            gate["note"] = ("The champion is re-scored on the challenger's test window. Newly recorded outcomes fall mostly "
                            "in that latest window, so neither model was fitted on them for this comparison.")
        except Exception as exc:  # a broken champion must not block learning
            gate["champion"] = None
            gate["championError"] = str(exc)[:200]
    else:
        gate["champion"] = None

    if gate["champion"] is None:
        passed, reason = True, "No champion model is published yet; the challenger becomes the first champion."
    else:
        c, ch = gate["champion"], gate["challenger"]
        pr_ok = ch["prAuc"] >= c["prAuc"] - GATE["prAucTolerance"]
        br_ok = ch["brier"] <= c["brier"] + GATE["brierTolerance"]
        passed = pr_ok and br_ok
        reason = (f"Challenger PR-AUC {ch['prAuc']:.4f} vs champion {c['prAuc']:.4f}; Brier {ch['brier']:.4f} vs {c['brier']:.4f}. "
                  + ("Within tolerance — promoted." if passed else "Worse than the champion beyond tolerance — rejected."))
    promote = args.promote == "always" or (args.promote == "auto" and passed)
    gate.update({"passed": bool(passed), "promoted": bool(promote), "mode": args.promote, "reason": reason})
    log(f"gate: {reason}  promote={promote}")

    data_hash = hashlib.sha256(((sha256_of(csv_path) or "") + (sha256_of(outcomes_path) or "")).encode()).hexdigest()[:16]
    entry = {
        "id": version_id,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "triggeredBy": args.triggered_by,
        "status": "champion" if promote else "rejected",
        "corpusRows": int(n_rows),
        "observedRows": int(n_obs),
        "outcomesApplied": outcome_info["applied"],
        "dataHash": data_hash,
        "features": len(names),
        "test": gate["challenger"],
        "gate": {k: gate[k] for k in ("passed", "promoted", "reason", "champion")},
    }

    if not promote:
        (STAGING / "evaluation.json").write_text(json.dumps({"version": version_id, "gate": gate, "models": models}, indent=1), encoding="utf-8")
        registry["versions"].append(entry)
        save_registry(registry)
        keep_champion_servable(df, champion_model, registry, bool(args.sample))
        log(f"challenger {version_id} not promoted; champion unchanged. ({time.time() - t_start:.1f}s)")
        return 0

    # ---------------------------------------- refit on every labelled row
    log("refitting the promoted model on every labelled row (iterations fixed from the evaluation fit)…")
    t0 = time.time()
    deploy = HistGradientBoostingClassifier(**gbm_params(max_iter=int(gbm.n_iter_), early_stopping=False))
    deploy.fit(X[obs_sorted], y[obs_sorted])
    log(f"  refit done in {time.time() - t0:.1f}s")

    log("scoring the full corpus…")
    scores = np.zeros(n_rows, dtype=np.float32)
    step = 50000
    for s in range(0, n_rows, step):
        scores[s: s + step] = deploy.predict_proba(X[s: s + step])[:, 1].astype(np.float32)
    (STAGING / "scores.f32").write_bytes(scores.tobytes())

    # ------------------------------------------------ expected slip (days)
    log("training conditional slip regressor…")
    slip_all = num(df, "actual_stage_delay_days")
    delayed_known = (~np.isnan(slip_all)) & (slip_all > DELAY_THRESHOLD_DAYS)
    tr_r, te_r = tr[delayed_known[tr]], te[delayed_known[te]]
    reg = HistGradientBoostingRegressor(**slip_params())
    reg.fit(X[tr_r], slip_all[tr_r])
    cond_te = reg.predict(X[te_r])
    cond_baseline = float(np.median(slip_all[tr_r]))
    all_r = obs_sorted[delayed_known[obs_sorted]]
    reg_deploy = HistGradientBoostingRegressor(**slip_params(max_iter=int(reg.n_iter_), early_stopping=False))
    reg_deploy.fit(X[all_r], slip_all[all_r])
    delay_days = np.zeros(n_rows, dtype=np.float32)
    for s in range(0, n_rows, step):
        cond = np.clip(reg_deploy.predict(X[s: s + step]), DELAY_THRESHOLD_DAYS + 1, 400)
        delay_days[s: s + step] = (scores[s: s + step] * cond).astype(np.float32)
    (STAGING / "delay_days.f32").write_bytes(delay_days.tobytes())
    slip_model = {
        "label": "Expected slip = P(delayed) x conditional slip regressor (HistGradientBoosting, absolute error)",
        "trainRows": int(len(tr_r)), "testRows": int(len(te_r)),
        "conditionalTestMae": round(float(mean_absolute_error(slip_all[te_r], cond_te)), 2),
        "conditionalBaselineMae": round(float(mean_absolute_error(slip_all[te_r], np.full(len(te_r), cond_baseline))), 2),
        "meanExpectedSlipOpen": round(float(delay_days[~observed].mean()), 2) if (~observed).any() else None,
        "caveat": "Test milestones are right-censored: long slips in the latest window are not yet resolved, so test MAE understates real-world error.",
    }

    # ------------------------------------------------------- tree export
    ensemble = {
        "kind": "HistGradientBoosting trees exported for dependency-free scoring and exact TreeSHAP in the API",
        "version": version_id,
        "features": spec,
        "categories": cats,
        "operatingThreshold": round(float(thr_gbm), 4),
        "riskBands": RISK_BAND_THRESHOLDS,
        "projectRiskBands": PROJECT_RISK_BAND_THRESHOLDS,
        "delayThresholdDays": DELAY_THRESHOLD_DAYS,
        "classifier": export_trees(deploy, len(names)),
        "slip": {**export_trees(reg_deploy, len(names)), "floor": DELAY_THRESHOLD_DAYS + 1, "cap": 400},
    }
    probe = X[np.random.default_rng(3).choice(n_rows, size=min(3000, n_rows), replace=False)]
    parity = float(np.max(np.abs(sigmoid(predict_raw(ensemble["classifier"], probe)) - deploy.predict_proba(probe)[:, 1])))
    parity_slip = float(np.max(np.abs(predict_raw(ensemble["slip"], probe) - reg_deploy.predict(probe))))
    if parity > 1e-6 or parity_slip > 1e-4:
        log(f"tree export parity failed: classifier {parity}, slip {parity_slip}")
        return 2
    ensemble["exportParity"] = {"maxAbsProbabilityDiff": parity, "maxAbsSlipDiff": parity_slip, "rows": int(len(probe))}
    log(f"  exported {len(ensemble['classifier']['trees'])} + {len(ensemble['slip']['trees'])} trees, parity {parity:.2e}")

    # ------------------------------------------------------ permutation
    log("permutation importance on a validation sample (evaluation fit)…")
    rng = np.random.default_rng(7)
    pick = rng.choice(len(va), size=min(6000, len(va)), replace=False)
    Xp, yp = Xva[pick], yva[pick]
    base = roc_auc_score(yp, gbm.predict_proba(Xp)[:, 1])
    perm = []
    for j, name in enumerate(names):
        Xs = Xp.copy()
        Xs[:, j] = Xs[rng.permutation(len(Xs)), j]
        perm.append({"feature": name, "group": spec[j]["group"], "label": spec[j]["label"],
                     "aucDrop": round(float(base - roc_auc_score(yp, gbm.predict_proba(Xs)[:, 1])), 5)})
    perm.sort(key=lambda r: -r["aucDrop"])

    # -------------------------------------------------------------- SHAP
    shap_rows = args.shap_rows if args.shap_rows > 0 else n_rows
    shap_summary, shap_meta = [], {}
    try:
        import shap  # noqa: PLC0415

        log(f"computing TreeSHAP for {shap_rows:,} rows…")
        t0 = time.time()
        explainer = shap.TreeExplainer(deploy)
        top_idx = np.zeros((n_rows, TOP_K_SHAP), dtype=np.int16)
        top_val = np.zeros((n_rows, TOP_K_SHAP), dtype=np.float32)
        abs_sum = np.zeros(len(names), dtype=np.float64)
        done = 0
        for s in range(0, shap_rows, 20000):
            end = min(s + 20000, shap_rows)
            sv = np.asarray(explainer.shap_values(X[s:end], check_additivity=False))
            if sv.ndim == 3:
                sv = sv[:, :, 1]
            abs_sum += np.abs(sv).sum(axis=0)
            order = np.argsort(-np.abs(sv), axis=1)[:, :TOP_K_SHAP]
            top_idx[s:end] = order.astype(np.int16)
            top_val[s:end] = np.take_along_axis(sv, order, axis=1).astype(np.float32)
            done += end - s
            if (s // 20000) % 4 == 0:
                log(f"  shap {done:,}/{shap_rows:,}")
        mean_abs = abs_sum / max(1, done)
        shap_summary = sorted(({"feature": names[j], "group": spec[j]["group"], "label": spec[j]["label"],
                                "meanAbsShap": round(float(mean_abs[j]), 6)} for j in range(len(names))),
                              key=lambda r: -r["meanAbsShap"])
        with open(STAGING / "shap_top.bin", "wb") as fh:
            fh.write(struct.pack("<III", n_rows, TOP_K_SHAP, 1))
            fh.write(top_idx.tobytes())
            fh.write(top_val.tobytes())
        base_value = float(np.ravel(explainer.expected_value)[-1])
        shap_meta = {"available": True, "rows": int(done), "topK": TOP_K_SHAP, "baseValue": round(base_value, 6),
                     "unit": "log-odds", "seconds": round(time.time() - t0, 1)}
        ensemble["shapBaseValue"] = base_value
        log(f"  shap done in {time.time() - t0:.1f}s")
    except Exception as exc:  # pragma: no cover - optional dependency
        log(f"  shap unavailable ({exc}); the API computes TreeSHAP from the exported trees on demand")
        shap_meta = {"available": False, "reason": str(exc)[:200]}

    # --------------------------------------------------------- surrogate
    # Linear reference distilled from the evaluation fit. The API scores with the
    # exported trees; the surrogate carries the feature statistics (defaults,
    # ranges) and is reported as a transparency reference.
    log("distilling the linear reference model…")
    clip = lambda p: np.clip(p, 1e-6, 1 - 1e-6)
    p_tr = clip(gbm.predict_proba(Xtr)[:, 1])
    ridge = Ridge(alpha=1.0)
    ridge.fit((Xtr_i - mu) / sd, np.log(p_tr) - np.log(1 - p_tr))
    sur_va = sigmoid(ridge.predict((Xva_i - mu) / sd))
    g_logit, s_logit = np.log(clip(gbm_va) / (1 - clip(gbm_va))), np.log(clip(sur_va) / (1 - clip(sur_va)))
    cuts = [RISK_BAND_THRESHOLDS["medium"], RISK_BAND_THRESHOLDS["high"], RISK_BAND_THRESHOLDS["critical"]]
    fidelity = {
        "logOddsR2": round(1 - float(np.sum((g_logit - s_logit) ** 2)) / float(np.sum((g_logit - g_logit.mean()) ** 2)), 4),
        "spearman": round(float(pd.Series(sur_va).corr(pd.Series(gbm_va), method="spearman")), 4),
        "meanAbsProbDiff": round(float(np.mean(np.abs(sur_va - gbm_va))), 4),
        "bandAgreement": round(float(np.mean(np.digitize(sur_va, cuts) == np.digitize(gbm_va, cuts))), 4),
        "rocAuc": round(float(roc_auc_score(yva, sur_va)), 4),
    }
    surrogate = {
        "kind": "feature statistics + linear reference distilled from the evaluation fit (the API scores with ensemble.json)",
        "intercept": float(ridge.intercept_),
        "fidelity": fidelity,
        "riskBands": RISK_BAND_THRESHOLDS,
        "projectRiskBands": PROJECT_RISK_BAND_THRESHOLDS,
        "features": [{**spec[j], "mean": float(mu[j]), "std": float(sd[j]), "median": float(med[j]), "coef": float(ridge.coef_[j])}
                     for j in range(len(names))],
        "categories": cats,
    }

    all_bands = np.digitize(scores, cuts)
    band_mix = {nm: int((all_bands == i).sum()) for i, nm in enumerate(["Low", "Medium", "High", "Critical"])}
    metrics = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "version": version_id,
        "corpusRows": int(n_rows),
        "features": len(names),
        "target": {"name": "next_milestone_delayed",
                   "definition": f"the current stage's next milestone slips by more than {DELAY_THRESHOLD_DAYS} days",
                   "positiveRateObserved": round(float(np.mean(y[obs_sorted])), 4)},
        "split": split_info,
        "models": models,
        "deployed": "gradient_boosting",
        "deployment": {
            "evaluation": "metrics above come from the fit on the training window only, scored on the later validation / test windows",
            "published": f"after passing the gate the same configuration is refitted on all {int(n_obs):,} labelled rows with the iteration count fixed at {int(gbm.n_iter_)}; that refit is what the API scores",
            "servedFrom": "ensemble.json (exported trees, evaluated in Node; exact TreeSHAP for new records)",
        },
        "gate": gate,
        "learning": {"outcomes": outcome_info, "triggeredBy": args.triggered_by},
        "operatingThreshold": round(float(thr_gbm), 4),
        "curves": {"validation": curve_points(yva, gbm_va), "test": curve_points(yte, gbm_te)},
        "calibration": calibration_bins(yte, gbm_te),
        "slices": {"projectType": slice_metrics(df, te, yte, gbm_te, thr_gbm, "project_type"),
                   "currentStage": slice_metrics(df, te, yte, gbm_te, thr_gbm, "current_stage")},
        "shap": shap_meta,
        "riskBands": RISK_BAND_THRESHOLDS,
        "projectRiskBands": PROJECT_RISK_BAND_THRESHOLDS,
        "riskBandMix": band_mix,
        "surrogateFidelity": fidelity,
        "slipModel": slip_model,
        "exportParity": ensemble["exportParity"],
        "leakageControls": [
            "targets and actual_stage_delay_days are never features",
            "only rows whose milestone outcome is already knowable are used for training",
            "split is chronological on assessment_date, with no shuffling",
            "imputation, scaling and the linear reference are fitted on the training window only",
            "state, authority and coordinates are not features, so geography acts only through recorded history",
        ],
        "trainingSeconds": round(time.time() - t_start, 1),
    }

    (STAGING / "ensemble.json").write_text(json.dumps(ensemble), encoding="utf-8")
    (STAGING / "surrogate.json").write_text(json.dumps(surrogate), encoding="utf-8")
    (STAGING / "metrics.json").write_text(json.dumps(metrics, indent=1), encoding="utf-8")
    (STAGING / "importance.json").write_text(json.dumps({"permutation": perm, "shap": shap_summary}, indent=1), encoding="utf-8")
    (STAGING / "feature-spec.json").write_text(json.dumps({"features": spec, "categories": cats, "names": names}, indent=1), encoding="utf-8")

    # ------------------------------------------------------------ publish
    for name in ARTEFACTS:
        src = STAGING / name
        if src.exists():
            shutil.copy2(src, MODEL / name)
    archive = VERSIONS / version_id
    archive.mkdir(parents=True, exist_ok=True)
    for name in ARTEFACTS:
        if (STAGING / name).exists():
            shutil.copy2(STAGING / name, archive / name)
    for v in registry["versions"]:
        if v.get("status") == "champion":
            v["status"] = "archived"
    registry["versions"].append(entry)
    registry["champion"] = version_id
    kept = [v["id"] for v in registry["versions"] if v["status"] in ("champion", "archived")][-KEEP_VERSIONS:]
    for d in VERSIONS.iterdir() if VERSIONS.exists() else []:
        if d.is_dir() and d.name not in kept:
            shutil.rmtree(d, ignore_errors=True)
    for v in registry["versions"]:
        v["archived"] = v["id"] in kept
    save_registry(registry)
    shutil.rmtree(STAGING, ignore_errors=True)

    log(f"published {version_id} in {time.time() - t_start:.1f}s · test ROC-AUC {challenger_test['rocAuc']} PR-AUC {challenger_test['prAuc']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
