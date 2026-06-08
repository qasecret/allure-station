import type { QualityGateConfig } from "@allure-station/shared";

export interface QgForm {
  maxFailures: string;
  minTests: string;
  minPassRate: string;    // percent, e.g. "95"
  maxDurationSec: string; // seconds
}

export function qgConfigToForm(cfg: QualityGateConfig): QgForm {
  const s = (n: number | undefined) => (n === undefined ? "" : String(n));
  return {
    maxFailures: s(cfg.maxFailures),
    minTests: s(cfg.minTests),
    minPassRate: cfg.minPassRate === undefined ? "" : String(Math.round(cfg.minPassRate * 100)),
    maxDurationSec: cfg.maxDurationMs === undefined ? "" : String(Math.round(cfg.maxDurationMs / 1000)),
  };
}

export function qgFormToConfig(form: QgForm): QualityGateConfig {
  const cfg: QualityGateConfig = {};
  if (form.maxFailures !== "") cfg.maxFailures = Number(form.maxFailures);
  if (form.minTests !== "") cfg.minTests = Number(form.minTests);
  if (form.minPassRate !== "") cfg.minPassRate = Number(form.minPassRate) / 100;
  if (form.maxDurationSec !== "") cfg.maxDurationMs = Number(form.maxDurationSec) * 1000;
  return cfg;
}
