import { Technique, TechniqueLevel } from "@/lib/types";

export const TAXONOMY_LEVEL_LABELS: Record<TechniqueLevel, string> = {
  1: "Level 1",
  2: "Level 2",
  3: "Level 3",
};

export const TAXONOMY_LEVEL_DESCRIPTIONS: Record<TechniqueLevel, string> = {
  1: "Signals",
  2: "Argument Techniques",
  3: "Power Patterns",
};

export const TAXONOMY_LEVEL_BADGE_CLASSES: Record<TechniqueLevel, string> = {
  1: "border-teal-300 bg-teal-50 text-teal-800",
  2: "border-amber-300 bg-amber-50 text-amber-800",
  3: "border-violet-300 bg-violet-50 text-violet-800",
};

export function groupTechniquesByLevel(techniques: Technique[]): Record<TechniqueLevel, Technique[]> {
  return techniques.reduce<Record<TechniqueLevel, Technique[]>>(
    (groups, technique) => {
      groups[technique.level].push(technique);
      return groups;
    },
    {
      1: [],
      2: [],
      3: [],
    },
  );
}
