import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import { Title } from "@/components/ui";
import { minTapTarget, useTheme } from "@/lib/theme";

/** Section title with a pencil toggle (spec Part 5). */
export function SectionTitle({
  title,
  editing,
  onToggle,
}: {
  title: string;
  editing: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Title>{title}</Title>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editing ? `Stop editing ${title}` : `Edit ${title}`}
        onPress={onToggle}
        hitSlop={8}
        style={({ pressed }) => ({
          width: minTapTarget - 8,
          height: minTapTarget - 8,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: (minTapTarget - 8) / 2,
          backgroundColor: pressed ? colors.cardPressed : "transparent",
        })}
      >
        <Ionicons
          name={editing ? "close-outline" : "create-outline"}
          size={20}
          color={colors.textMuted}
        />
      </Pressable>
    </View>
  );
}

/** Reorder/remove controls for one editable row. */
export function EditRowControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const { colors } = useTheme();
  const iconButton = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}
    >
      <Ionicons name={icon} size={18} color={colors.textMuted} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {iconButton(
        "Move up",
        "chevron-up",
        () => onMove(index, index - 1),
        index === 0,
      )}
      {iconButton(
        "Move down",
        "chevron-down",
        () => onMove(index, index + 1),
        index === count - 1,
      )}
      {iconButton("Remove", "trash-outline", () => onRemove(index))}
    </View>
  );
}
