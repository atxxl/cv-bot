# MSc thesis — Exploring Concept Bottleneck Models for Sentiment Analysis (DTU, 2024)

Role: MSc thesis in Human-Centered Artificial Intelligence at DTU Compute, Section for Cognitive Systems, six months of individual work, defended in 2024. Supervisors: Professor Lars Kai Hansen and PhD student Teresa Karen Scheidt. Code: https://github.com/atxxl/concept-based-XAI

## Why this topic

- I chose the topic myself. I wanted to apply explainable AI to sentiment analysis, and after reading through the literature the closest recent work was the Sparse Concept Bottleneck Model paper by Tan et al. (2023). Their experiments had worked, so I set out to reproduce the method and then try it on a different dataset.

## Research question

- How do different sparsity settings affect the performance of Concept Bottleneck Models (CBMs) in sentiment analysis, and can the models explain their predictions through concepts while keeping accuracy and stability on the GoEmotions dataset?
- A CBM predicts an intermediate set of human-readable concepts first (here: the 28 GoEmotions emotions) and then predicts the label (here: a sentiment score from 1 to 5) only from those concepts, so every prediction comes with the concepts that produced it.

## What I built

- Reproduced the Sparse CBM of Tan et al. on the CEBaB restaurant-review dataset as a starting point, reaching 84.3% concept accuracy and 63.4% label accuracy, consistent with the paper.
- GoEmotions has emotion labels but no sentiment score, so I built the sentiment labels myself: compared RoBERTa, BERTweet and RoBERTa-Sentiment on SemEval-2016 Task 4 (five-point Twitter sentiment), grid-searched learning rate and batch size, and fine-tuned the best one (RoBERTa-Sentiment, retrained on the balanced set) to 63.1% accuracy and a mean absolute error of 0.41 on the five-point scale. This intermediate model took the most time of the whole project.
- Scored all GoEmotions comments with that model and kept only predictions with confidence above 0.5 as a reject option, which cut the data from 211,225 to 96,392 rows; the CBM experiments then used a 1,000-row sample (800/100/100 train/dev/test) to match the scale of the CEBaB reproduction.
- Mapped GoEmotions' binary emotion labels into the CEBaB concept format: an emotion that is present is "positive", one that is absent is "unknown" (not "negative"), because an absent emotion does not mean its opposite.
- Ran the Sparse CBM (DistilBERT backbone, joint training, Fisher-information pruning) on DTU's HPC cluster with experiments tracked on Weights & Biases: seven hyperparameter groups (learning rate, batch size, lambda, lambda X-to-C, number of gradients for the Fisher matrix, block size, initial/final sparsity) plus paired sparsity combinations, 9 experiment groups and 73 tracked runs in total.
- Wrote a negation-based augmentation experiment to check that the sentiment model reacts to meaning: random insertion of "not", syntactic insertion of "not" after a verb (NLTK part-of-speech tags), and adjective-to-antonym replacement via WordNet, on 100 and 1,000 samples.
- Did exploratory analysis of the dataset: log-odds ratio with an informative Dirichlet prior to find the characteristic words per emotion, an emotion correlation matrix, PCA over the 28 emotions coloured by sentiment, and an outlier analysis of the PCA cluster.

## What I found

- Moderate sparsity worked best: initial/final sparsity of 0.5/0.7 reached 80% validation accuracy on sentiment labels with a standard error of 0.043, the best of all runs.
- McNemar's test on the same test set: sparsity 0.5–0.7 versus 0.3–0.5 showed no significant difference (p = 0.118), while 0.5–0.7 versus 0.7–0.9 did (p = 0.015). Pruning up to about 70% of the weights kept accuracy; beyond that it dropped.
- Very different regularisation strengths landed on the same accuracy (lambda 10 and lambda 5e-5 both reached 0.80), so the model was robust to lambda within a wide range.
- Small learning rates (1e-5, 5e-5) trained stably; 0.1 and 0.5 oscillated and lost concept accuracy. Larger batches and smaller Fisher block sizes gave lower standard error. Batch size 8 ran out of memory on an 80 GB A100, so 7 was the largest tested.
- The concept predictor did not work as hoped: over 90% of concept labels in the data are "unknown", so the concept predictor mostly predicted "unknown" and misclassified present emotions as absent. The label predictor still reached 80% through the bottleneck, but the explanations (which emotions fired) were not reliable.
- Syntactic "not" insertion was the most reliable way to flip sentiment (25% of 1,000 samples changed, average shift 0.45 on the five-point scale); antonym replacement changed the least (15.6%) and its scatter looked like the random method, which suggested that implementation was not doing what it should.

## What I learned

- I did not look at the label distribution before training the CBM. The 90% "unknown" imbalance explains the concept predictor result, and I would have seen it earlier with one histogram. If I did the project again, the first change would be to rebalance the dataset before any training.
- The question that caught me at the defence was what the Fisher information equation does in the method. The answer: its diagonal estimates how much each weight affects the loss, and pruning keeps the weights with the highest weight-squared times Fisher score and zeroes the rest.

## Limitations I stated in the thesis

- The sentiment scores used as labels were produced by a model trained on Twitter data, not by human annotators, so label noise and a Twitter-style bias are baked into the dataset.
- The data is imbalanced twice over: a few emotions ("admiration", "approval", "neutral") dominate, and within each emotion the "unknown" class is over 90%. The CBM learned the majority class.
- The CBM experiments ran on 1,000 rows, chosen to match the CEBaB reproduction and to keep 28-concept training affordable; results at full scale were not tested.
- Proposed next steps: oversampling or synthetic data for rare emotions, transfer from a more balanced dataset, and a real "negative" concept class instead of folding absence into "unknown".

## Tools

- Python, PyTorch, Hugging Face Transformers (DistilBERT, RoBERTa, BERTweet), NLTK, WordNet, scikit-learn, Weights & Biases, DTU HPC (A100).

## Not done in the thesis

- No human evaluation of the explanations; interpretability was assessed through concept confusion matrices, not user studies.
- No comparison against a non-CBM baseline such as a plain fine-tuned DistilBERT on the same sentiment labels.
- No inference-time intervention on concepts (the second half of the Tan et al. method) was tried.
- The grade is not part of this material.
