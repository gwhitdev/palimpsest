# analysis/kappa_analysis.R
# Fleiss kappa per technique from Palimpsest CSV export

suppressPackageStartupMessages({
  library(tidyverse)
  library(irr)
})

# Load export and normalise column names across legacy/new formats.
df_raw <- read_csv("palimpsest_annotations.csv", show_col_types = FALSE)

normalise_export_columns <- function(df) {
  out <- df

  if ("TechniqueID" %in% names(out) && !("technique_id" %in% names(out))) {
    out <- out %>% rename(technique_id = TechniqueID)
  }
  if ("Document" %in% names(out) && !("document" %in% names(out))) {
    out <- out %>% rename(document = Document)
  }
  if ("CoderName" %in% names(out) && !("coder_name" %in% names(out))) {
    out <- out %>% rename(coder_name = CoderName)
  }
  if ("IsAI" %in% names(out) && !("is_ai" %in% names(out))) {
    out <- out %>% rename(is_ai = IsAI)
  }
  if ("Accepted" %in% names(out) && !("accepted" %in% names(out))) {
    out <- out %>% rename(accepted = Accepted)
  }

  if (!("round_number" %in% names(out))) {
    out <- out %>% mutate(round_number = NA_integer_)
  }

  out %>%
    mutate(
      is_ai = as.logical(is_ai),
      accepted = as.logical(accepted),
      round_number = as.integer(round_number)
    )
}

df <- normalise_export_columns(df_raw) %>%
  filter(is_ai == FALSE, accepted == TRUE)

required <- c("technique_id", "document", "coder_name")
missing <- required[!(required %in% names(df))]
if (length(missing) > 0) {
  stop(paste("Missing required columns:", paste(missing, collapse = ", ")))
}

techniques <- unique(df$technique_id)

results <- map_dfr(techniques, function(tech) {
  tech_data <- df %>%
    filter(technique_id == tech) %>%
    select(document, coder_name, round_number) %>%
    mutate(present = 1)

  wide <- tech_data %>%
    select(document, coder_name, present) %>%
    pivot_wider(names_from = coder_name, values_from = present, values_fill = 0)

  rating_matrix <- wide %>% select(-document) %>% as.matrix()

  if (ncol(rating_matrix) < 2 || nrow(rating_matrix) < 2) {
    return(tibble(
      technique = tech,
      kappa = NA_real_,
      z_score = NA_real_,
      p_value = NA_real_,
      n_docs = nrow(wide),
      n_coders = ncol(rating_matrix)
    ))
  }

  k <- kappam.fleiss(rating_matrix)

  tibble(
    technique = tech,
    kappa = round(k$value, 3),
    z_score = round(k$statistic, 3),
    p_value = round(k$p.value, 4),
    n_docs = nrow(wide),
    n_coders = ncol(rating_matrix)
  )
})

results <- results %>%
  mutate(
    status = case_when(
      kappa >= 0.90 ~ "Near-perfect",
      kappa >= 0.80 ~ "Strong",
      kappa >= 0.70 ~ "Acceptable",
      kappa >= 0.60 ~ "Moderate",
      kappa >= 0.40 ~ "Fair",
      TRUE ~ "Poor"
    ),
    action = case_when(
      kappa >= 0.90 ~ "Done",
      kappa >= 0.80 ~ "Lock the definition",
      kappa >= 0.70 ~ "Minor notes only",
      kappa >= 0.60 ~ "Clarify decision rules",
      kappa >= 0.40 ~ "Add boundary examples",
      TRUE ~ "Rewrite technique definition"
    ),
    priority = case_when(
      kappa < 0.40 ~ 1,
      kappa < 0.60 ~ 2,
      kappa < 0.70 ~ 3,
      TRUE ~ 4
    )
  ) %>%
  arrange(priority, kappa)

cat("\n=== REVISION PRIORITY TABLE ===\n\n")
print(results %>% select(technique, kappa, status, action), n = Inf)

write_csv(results, "analysis/kappa_results.csv")
cat("\nSaved to analysis/kappa_results.csv\n")
