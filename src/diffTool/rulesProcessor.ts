/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {
  Engine,
  RuleProperties,
  Event,
  Almanac,
  RuleResult,
  EngineResult
} from "json-rules-engine";
import { NodeDiff } from "./jsonDiff";
import fs from "fs-extra";
import { ramlToolLogger } from "../common/logger";
import customOperators from "./customOperators";
/* eslint-disable @typescript-eslint/no-use-before-define */

//ID for the diff node/fact that is passed to the rule engine
export const DIFF_FACT_ID = "diff";

/**
 * Apply rules on the AMF node differences, updates passed rules details in the node
 * @param diffs - Array of differences
 * @param rulesPath - File path of the rules
 */
export async function applyRules(
  diffs: NodeDiff[],
  rulesPath: string
): Promise<NodeDiff[]> {
  if (!diffs || diffs.length == 0) {
    ramlToolLogger.info("No differences to apply the rules");
    return diffs;
  }
  const rules = loadRulesFile(rulesPath);
  if (!rules || rules.length == 0) {
    ramlToolLogger.info("No rules to apply on the differences");
    return diffs;
  }
  //initialize engine with rules
  const engine = new Engine(rules);
  //callback function to execute when a rule is passed/evaluates to true
  engine.on("success", successHandler);
  //Add custom operators to use in rules
  customOperators.map(o => engine.addOperator(o));

  /**
   * run rules on diffs
   *
   * Result from the engine run is processed by the callback, the success handler. So the "EngineResult" returned by the runEngine function is ignored here.
   * Also callback has access to RuleResult which has all the details of the rule that is applied whereas EngineResult do not
   */
  const promises = diffs.map(diff => {
    return runEngine(engine, diff);
  });
  await Promise.all(promises);
  return diffs;
}

/**
 * Get rules from rules json file
 * @param rulesPath - Path to rules json file
 *
 * @returns Array of rules
 */
function loadRulesFile(rulesPath: string): RuleProperties[] {
  let rules: RuleProperties[];
  try {
    rules = fs.readJSONSync(rulesPath);
  } catch (error) {
    error.message = `Error parsing the rules file: ${error.message}`;
    throw error;
  }
  if (!Array.isArray(rules)) {
    throw new Error("Rules must be defined as a json array");
  }
  return rules;
}

/**
 * Callback function that executes when a rule is passed/evaluates to true on a diff
 * @param event - Event defined in the rule
 * @param almanac - Almanac that has the fact/diff on which the rule is applied
 * @param ruleResult - Result of rule execution
 */
async function successHandler(
  event: Event,
  almanac: Almanac,
  ruleResult: RuleResult
): Promise<void> {
  const nodeDiff: NodeDiff = await almanac.factValue(DIFF_FACT_ID);
  ramlToolLogger.debug(
    `Rule '${ruleResult.name}' is passed on difference '${nodeDiff.id}'`
  );
  //Add rule details to the diff
  nodeDiff.rule = {
    name: ruleResult.name,
    type: event.type,
    params: event.params
  };
}

/**
 * Apply rules on a difference
 * @param engine - Rules Engine
 * @param diff - Difference of a node
 */
function runEngine(engine: Engine, diff: NodeDiff): Promise<EngineResult> {
  ramlToolLogger.debug(`Running rules on diff: ${diff.id}`);
  /**
   * json-rules-engine adds some metadata to the provided fact.
   * Wrapping diff object in a json prevents engine from modifying it. Engine now adds metadata to the wrapped object
   * https://github.com/CacheControl/json-rules-engine/issues/187
   */
  return engine.run({ [DIFF_FACT_ID]: diff });
}
