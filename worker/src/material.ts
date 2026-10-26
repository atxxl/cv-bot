// GENERATED FILE. Do not edit by hand.
//
// Built by scripts/bundle_material.py from material/*.md (README.md excluded).
// After any change under material/, regenerate with:
//
//   python scripts/bundle_material.py
//
// CI runs `python scripts/bundle_material.py --check` and fails when this
// file is out of date.
//
// Sources (2 file(s)): mai.md, thesis.md

/** One citable line of the approved material. */
export interface MaterialLine {
  /**
   * Stable citation id `<file stem>#<n>`: n is the 1-based index of the line
   * among the non-empty lines of its source file (`mai#3` is the third
   * non-empty line of `material/mai.md`).
   */
  id: string;
  /** The line as written in the material, trailing whitespace removed. */
  text: string;
}

/** sha256 of the bundled source files (sorted, newline-normalised), first 12 hex chars. */
export const MATERIAL_HASH: string = "e6b3039f8901";

export const MATERIAL: MaterialLine[] = [
  { id: "mai#1", text: "# mAI (now 1-to-X.ai) — AI Engineer internship, 2026" },
  { id: "mai#2", text: "Role: AI Engineer intern at mAI (now 1-to-X.ai), a platform that generates business software through an agentic LLM pipeline. Stack: Python backend, Next.js/TypeScript frontend, PostgreSQL. The product serves 50+ customers." },
  { id: "mai#3", text: "## What I built" },
  { id: "mai#4", text: "- Built a build-request approval workflow end to end: a new `rebuild_requests` table, four backend scripts (submit, load pending, approve, reject), Next.js pages for requesting and reviewing, notifications to the requester, and request history with audit fields (who resolved it, when)." },
  { id: "mai#5", text: "- On approval the backend creates a task in the project's task board and hands off to the agentic build pipeline as a background job; the frontend polls the job status." },
  { id: "mai#6", text: "- Rejections require a reason. The sidebar shows the live count of pending requests." },
  { id: "mai#7", text: "- Extended infrastructure settings with VM backup configuration: four new database columns, load and save scripts, and a configuration card in the admin UI. Built and tested locally; this change was not merged into the main branch." },
  { id: "mai#8", text: "## What I fixed" },
  { id: "mai#9", text: "- Traced a silent failure in the pipeline hand-off: failed builds were recorded as successful and users were told \"rebuild completed\". The builder returned a failure object instead of raising, and the trigger script only caught exceptions." },
  { id: "mai#10", text: "- Fixed the result check so a failed build is recorded as failed and no success notification is sent." },
  { id: "mai#11", text: "- Added a backend guard that rejects an approval before any database write when the project has no architecture record, so the owner sees the error at approval time." },
  { id: "mai#12", text: "- Fixed the frontend call order: the build trigger used to fire before the approval had completed, so a build could start on an unapproved request. Now approval is awaited and checked first." },
  { id: "mai#13", text: "- Found a race where a page reload after approval could drop the build trigger before it reached the server. Moved the trigger into the backend, started after the database commit, so the build always starts regardless of frontend state." },
  { id: "mai#14", text: "- Replaced browser alert() with an error modal in the existing UI style; amber marks \"blocked\", red is reserved for destructive actions." },
  { id: "mai#15", text: "## Architecture view" },
  { id: "mai#16", text: "- Designed a visual language in the architecture view that marks connections to external services (third-party APIs, external auth): amber background and a globe icon on API files, a dashed amber border on the integrations directory to show the system boundary, and a legend entry." },
  { id: "mai#17", text: "- Designed it so that a planned second kind of outward connection (other projects in the same group) could be distinguished later without changing the language." },
  { id: "mai#18", text: "## How I worked" },
  { id: "mai#19", text: "- Ran the full stack locally on day one and worked across frontend and backend from then on." },
  { id: "mai#20", text: "- Wrote open questions before starting a task and a short reflection after finishing it." },
  { id: "mai#21", text: "- Used Claude Code day to day for codebase onboarding, style-consistent refactoring and documentation." },
  { id: "mai#22", text: "## Not done at mAI" },
  { id: "mai#23", text: "- Did not build the RAG or agent generation pipeline itself; worked on features that connect to it and on its failure detection." },
  { id: "mai#24", text: "- Did not write the Dockerfile or the CI/CD configuration." },
  { id: "thesis#1", text: "# MSc thesis — Exploring Concept Bottleneck Models for Sentiment Analysis (DTU, 2024)" },
  { id: "thesis#2", text: "Role: MSc thesis in Human-Centered Artificial Intelligence at DTU Compute, Section for Cognitive Systems, six months of individual work, defended in 2024. Supervisors: Professor Lars Kai Hansen and PhD student Teresa Karen Scheidt. Code: https://github.com/atxxl/concept-based-XAI" },
  { id: "thesis#3", text: "## Why this topic" },
  { id: "thesis#4", text: "- I chose the topic myself. I wanted to apply explainable AI to sentiment analysis, and after reading through the literature the closest recent work was the Sparse Concept Bottleneck Model paper by Tan et al. (2023). Their experiments had worked, so I set out to reproduce the method and then try it on a different dataset." },
  { id: "thesis#5", text: "## Research question" },
  { id: "thesis#6", text: "- How do different sparsity settings affect the performance of Concept Bottleneck Models (CBMs) in sentiment analysis, and can the models explain their predictions through concepts while keeping accuracy and stability on the GoEmotions dataset?" },
  { id: "thesis#7", text: "- A CBM predicts an intermediate set of human-readable concepts first (here: the 28 GoEmotions emotions) and then predicts the label (here: a sentiment score from 1 to 5) only from those concepts, so every prediction comes with the concepts that produced it." },
  { id: "thesis#8", text: "## What I built" },
  { id: "thesis#9", text: "- Reproduced the Sparse CBM of Tan et al. on the CEBaB restaurant-review dataset as a starting point, reaching 84.3% concept accuracy and 63.4% label accuracy, consistent with the paper." },
  { id: "thesis#10", text: "- GoEmotions has emotion labels but no sentiment score, so I built the sentiment labels myself: compared RoBERTa, BERTweet and RoBERTa-Sentiment on SemEval-2016 Task 4 (five-point Twitter sentiment), grid-searched learning rate and batch size, and fine-tuned the best one (RoBERTa-Sentiment, retrained on the balanced set) to 63.1% accuracy and a mean absolute error of 0.41 on the five-point scale. This intermediate model took the most time of the whole project." },
  { id: "thesis#11", text: "- Scored all GoEmotions comments with that model and kept only predictions with confidence above 0.5 as a reject option, which cut the data from 211,225 to 96,392 rows; the CBM experiments then used a 1,000-row sample (800/100/100 train/dev/test) to match the scale of the CEBaB reproduction." },
  { id: "thesis#12", text: "- Mapped GoEmotions' binary emotion labels into the CEBaB concept format: an emotion that is present is \"positive\", one that is absent is \"unknown\" (not \"negative\"), because an absent emotion does not mean its opposite." },
  { id: "thesis#13", text: "- Ran the Sparse CBM (DistilBERT backbone, joint training, Fisher-information pruning) on DTU's HPC cluster with experiments tracked on Weights & Biases: seven hyperparameter groups (learning rate, batch size, lambda, lambda X-to-C, number of gradients for the Fisher matrix, block size, initial/final sparsity) plus paired sparsity combinations, 9 experiment groups and 73 tracked runs in total." },
  { id: "thesis#14", text: "- Wrote a negation-based augmentation experiment to check that the sentiment model reacts to meaning: random insertion of \"not\", syntactic insertion of \"not\" after a verb (NLTK part-of-speech tags), and adjective-to-antonym replacement via WordNet, on 100 and 1,000 samples." },
  { id: "thesis#15", text: "- Did exploratory analysis of the dataset: log-odds ratio with an informative Dirichlet prior to find the characteristic words per emotion, an emotion correlation matrix, PCA over the 28 emotions coloured by sentiment, and an outlier analysis of the PCA cluster." },
  { id: "thesis#16", text: "## What I found" },
  { id: "thesis#17", text: "- Moderate sparsity worked best: initial/final sparsity of 0.5/0.7 reached 80% validation accuracy on sentiment labels with a standard error of 0.043, the best of all runs." },
  { id: "thesis#18", text: "- McNemar's test on the same test set: sparsity 0.5–0.7 versus 0.3–0.5 showed no significant difference (p = 0.118), while 0.5–0.7 versus 0.7–0.9 did (p = 0.015). Pruning up to about 70% of the weights kept accuracy; beyond that it dropped." },
  { id: "thesis#19", text: "- Very different regularisation strengths landed on the same accuracy (lambda 10 and lambda 5e-5 both reached 0.80), so the model was robust to lambda within a wide range." },
  { id: "thesis#20", text: "- Small learning rates (1e-5, 5e-5) trained stably; 0.1 and 0.5 oscillated and lost concept accuracy. Larger batches and smaller Fisher block sizes gave lower standard error. Batch size 8 ran out of memory on an 80 GB A100, so 7 was the largest tested." },
  { id: "thesis#21", text: "- The concept predictor did not work as hoped: over 90% of concept labels in the data are \"unknown\", so the concept predictor mostly predicted \"unknown\" and misclassified present emotions as absent. The label predictor still reached 80% through the bottleneck, but the explanations (which emotions fired) were not reliable." },
  { id: "thesis#22", text: "- Syntactic \"not\" insertion was the most reliable way to flip sentiment (25% of 1,000 samples changed, average shift 0.45 on the five-point scale); antonym replacement changed the least (15.6%) and its scatter looked like the random method, which suggested that implementation was not doing what it should." },
  { id: "thesis#23", text: "## What I learned" },
  { id: "thesis#24", text: "- I did not look at the label distribution before training the CBM. The 90% \"unknown\" imbalance explains the concept predictor result, and I would have seen it earlier with one histogram. If I did the project again, the first change would be to rebalance the dataset before any training." },
  { id: "thesis#25", text: "- The question that caught me at the defence was what the Fisher information equation does in the method. The answer: its diagonal estimates how much each weight affects the loss, and pruning keeps the weights with the highest weight-squared times Fisher score and zeroes the rest." },
  { id: "thesis#26", text: "## Limitations I stated in the thesis" },
  { id: "thesis#27", text: "- The sentiment scores used as labels were produced by a model trained on Twitter data, not by human annotators, so label noise and a Twitter-style bias are baked into the dataset." },
  { id: "thesis#28", text: "- The data is imbalanced twice over: a few emotions (\"admiration\", \"approval\", \"neutral\") dominate, and within each emotion the \"unknown\" class is over 90%. The CBM learned the majority class." },
  { id: "thesis#29", text: "- The CBM experiments ran on 1,000 rows, chosen to match the CEBaB reproduction and to keep 28-concept training affordable; results at full scale were not tested." },
  { id: "thesis#30", text: "- Proposed next steps: oversampling or synthetic data for rare emotions, transfer from a more balanced dataset, and a real \"negative\" concept class instead of folding absence into \"unknown\"." },
  { id: "thesis#31", text: "## Tools" },
  { id: "thesis#32", text: "- Python, PyTorch, Hugging Face Transformers (DistilBERT, RoBERTa, BERTweet), NLTK, WordNet, scikit-learn, Weights & Biases, DTU HPC (A100)." },
  { id: "thesis#33", text: "## Not done in the thesis" },
  { id: "thesis#34", text: "- No human evaluation of the explanations; interpretability was assessed through concept confusion matrices, not user studies." },
  { id: "thesis#35", text: "- No comparison against a non-CBM baseline such as a plain fine-tuned DistilBERT on the same sentiment labels." },
  { id: "thesis#36", text: "- No inference-time intervention on concepts (the second half of the Tan et al. method) was tried." },
  { id: "thesis#37", text: "- The grade is not part of this material." },
];
