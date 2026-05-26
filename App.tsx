import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image as RNImage,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Camera,
  Check,
  FileText,
  Image as ImageIcon,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Truck,
  X,
} from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';

import {
  MAX_PALLETS_PER_LOAD,
  clearPendingPickerContext,
  createLoad,
  createProcessingPallet,
  deleteLoad,
  deletePallet,
  getLoad,
  getPallet,
  getPendingPickerContext,
  initDatabase,
  listLoads,
  listPallets,
  markPalletError,
  resetPalletForProcessing,
  savePalletAnalysis,
  savePendingPickerContext,
  updateLoad,
  updatePalletManualCount,
  updatePalletName,
} from './src/database';
import { analyzePalletImage, imageDataUri } from './src/roboflow';
import { shareLoadPdf } from './src/pdf';
import { colors, radius, spacing } from './src/theme';
import type { Load, LoadSummary, Pallet, PendingPickerContext } from './src/types';

type Screen =
  | { name: 'home' }
  | { name: 'load'; loadId: number }
  | { name: 'pallet'; loadId: number; palletId: number };

type ImageSource = 'camera' | 'gallery';

type LoadModalState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; load: Load };

type PalletNameModalState =
  | { mode: 'closed' }
  | { mode: 'create'; source: ImageSource; loadId: number; defaultName: string }
  | { mode: 'edit'; pallet: Pallet };

type IconComponent = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

function screensEqual(first: Screen, second: Screen) {
  if (first.name !== second.name) {
    return false;
  }

  if (first.name === 'home' && second.name === 'home') {
    return true;
  }

  if (first.name === 'load' && second.name === 'load') {
    return first.loadId === second.loadId;
  }

  if (first.name === 'pallet' && second.name === 'pallet') {
    return first.loadId === second.loadId && first.palletId === second.palletId;
  }

  return false;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function defaultLoadName() {
  const date = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  return `Carga ${date}`;
}

function defaultPalletName(palletNumber: number) {
  return `Palete ${palletNumber}`;
}

function palletDisplayName(pallet: Pallet) {
  return pallet.name || defaultPalletName(pallet.pallet_number);
}

function nextPalletName(pallets: Pallet[]) {
  const nextNumber = pallets.reduce(
    (max, pallet) => Math.max(max, pallet.pallet_number),
    0,
  ) + 1;

  return defaultPalletName(nextNumber);
}

function averagePerPallet(total: number, palletCount: number) {
  return palletCount > 0 ? Math.round(total / palletCount) : 0;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForPickerLaunchWindow() {
  return new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(resolve, Platform.OS === 'android' ? 500 : 0);
    });
  });
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Algo deu errado.';

  if (
    message.includes('ActivityResultLauncher') ||
    message.includes('ImageLibraryContract') ||
    message.includes('launchImageLibraryAsync')
  ) {
    return 'A galeria nao abriu corretamente. Tente novamente; se continuar, feche e abra o app.';
  }

  return message;
}

async function saveCameraCaptureToGallery(uri: string | undefined) {
  if (!uri) {
    throw new Error('A camera nao retornou um arquivo para salvar na galeria.');
  }

  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);

  if (!permission.granted) {
    throw new Error('Permita salvar fotos na galeria para guardar as imagens tiradas pela camera.');
  }

  await MediaLibrary.Asset.create(uri);
}

function isImagePickerErrorResult(
  result: ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult,
): result is ImagePicker.ImagePickerErrorResult {
  return !('canceled' in result);
}

function PrimaryButton({
  label,
  icon: Icon,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
}: {
  label: string;
  icon?: IconComponent;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  const variantStyle = buttonVariants[variant];
  const textColor = disabled ? colors.softText : variantStyle.color;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        {
          backgroundColor: disabled ? colors.border : variantStyle.backgroundColor,
          borderColor: variantStyle.borderColor,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : Icon ? (
        <Icon color={textColor} size={18} strokeWidth={2.2} />
      ) : null}
      <Text style={[styles.buttonText, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function IconButton({
  label,
  icon: Icon,
  onPress,
  tone = 'neutral',
  disabled = false,
}: {
  label: string;
  icon: IconComponent;
  onPress: () => void;
  tone?: 'neutral' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  const color =
    tone === 'danger' ? colors.danger : tone === 'primary' ? colors.primary : colors.ink;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
        },
      ]}
    >
      <Icon color={color} size={20} strokeWidth={2.2} />
    </Pressable>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
}: {
  label: string;
  value: string | number;
  icon: IconComponent;
  tone?: 'primary' | 'accent' | 'blue';
}) {
  const toneColor =
    tone === 'accent' ? colors.accent : tone === 'blue' ? colors.blue : colors.primary;

  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: `${toneColor}18` }]}>
        <Icon color={toneColor} size={20} strokeWidth={2.3} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function EmptyState({
  title,
  detail,
  icon: Icon,
}: {
  title: string;
  detail: string;
  icon: IconComponent;
}) {
  return (
    <View style={styles.empty}>
      <Icon color={colors.softText} size={34} strokeWidth={1.8} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

function BottomActionBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bottomActionBar,
        {
          paddingBottom: Math.max(insets.bottom, spacing.md),
        },
      ]}
    >
      {children}
    </View>
  );
}

function PalletChart({ pallets }: { pallets: Pallet[] }) {
  const max = Math.max(1, ...pallets.map((pallet) => pallet.final_count));

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <BarChart3 color={colors.primary} size={18} strokeWidth={2.2} />
          <Text style={styles.sectionTitle}>Cabeças por palete</Text>
        </View>
      </View>
      <View style={styles.palletChart}>
        {pallets.length === 0 ? (
          <Text style={styles.chartEmpty}>Sem paletes</Text>
        ) : (
          pallets.map((pallet) => (
            <View key={pallet.id} style={styles.palletChartItem}>
              <Text style={styles.chartValue}>{pallet.final_count}</Text>
              <View style={styles.palletChartTrack}>
                <View
                  style={[
                    styles.palletChartBar,
                    {
                      width: `${Math.max(4, (pallet.final_count / max) * 100)}%`,
                      backgroundColor:
                        pallet.status === 'error' ? colors.danger : colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={styles.palletChartLabel}>P{pallet.pallet_number}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function HomeScreen({
  loads,
  onCreate,
  onOpen,
}: {
  loads: LoadSummary[];
  onCreate: () => void;
  onOpen: (loadId: number) => void;
}) {
  return (
    <View style={styles.screenShell}>
      <ScrollView contentContainerStyle={styles.screenContentWithBottomBar}>
        <View style={styles.hero}>
          <View>
            <Text style={styles.kicker}>Contador de Pupunha</Text>
            <Text style={styles.title}>Cargas</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cargas recentes</Text>

          {loads.length === 0 ? (
            <EmptyState
              detail="Crie uma carga para começar a registrar os paletes."
              icon={Truck}
              title="Nenhuma carga"
            />
          ) : (
            loads.map((load) => {
              const average = averagePerPallet(load.total_count, load.pallet_count);

              return (
                <Pressable
                  key={load.id}
                  onPress={() => onOpen(load.id)}
                  style={({ pressed }) => [
                    styles.loadRow,
                    styles.loadRowStack,
                    { opacity: pressed ? 0.76 : 1 },
                  ]}
                >
                  <View style={styles.loadRowHeader}>
                    <View style={styles.loadRowIcon}>
                      <Truck color={colors.primary} size={20} strokeWidth={2.2} />
                    </View>
                    <View style={styles.loadRowBody}>
                      <Text style={styles.loadRowTitle} numberOfLines={1}>
                        {load.name}
                      </Text>
                      <Text style={styles.loadRowMeta}>{formatDateTime(load.created_at)}</Text>
                    </View>
                  </View>

                  <View style={styles.loadMetricsRow}>
                    <View style={styles.loadMetric}>
                      <Text style={styles.loadMetricValue}>{load.pallet_count}</Text>
                      <Text style={styles.loadMetricLabel}>paletes</Text>
                    </View>
                    <View style={styles.loadMetric}>
                      <Text style={styles.loadMetricValue}>{load.total_count}</Text>
                      <Text style={styles.loadMetricLabel}>cabeças</Text>
                    </View>
                    <View style={styles.loadMetric}>
                      <Text style={styles.loadMetricValue}>{average}</Text>
                      <Text style={styles.loadMetricLabel}>média/palete</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      <BottomActionBar>
        <PrimaryButton icon={Plus} label="Nova carga" onPress={onCreate} />
      </BottomActionBar>
    </View>
  );
}

function LoadScreen({
  load,
  pallets,
  busyMessage,
  onBack,
  onEdit,
  onDelete,
  onExport,
  onAddCamera,
  onAddGallery,
  onOpenPallet,
}: {
  load: Load;
  pallets: Pallet[];
  busyMessage: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
  onAddCamera: () => void;
  onAddGallery: () => void;
  onOpenPallet: (palletId: number) => void;
}) {
  const canAdd = pallets.length < MAX_PALLETS_PER_LOAD && !busyMessage;

  return (
    <View style={styles.screenShell}>
      <ScrollView contentContainerStyle={styles.screenContentWithBottomBar}>
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} label="Voltar" onPress={onBack} />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={styles.kicker}>{formatDateTime(load.created_at)}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {load.name}
            </Text>
            {load.note ? (
              <Text style={styles.noteText} numberOfLines={3}>
                {load.note}
              </Text>
            ) : null}
          </View>
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeValue}>{load.total_count}</Text>
            <Text style={styles.totalBadgeLabel}>cabeças</Text>
          </View>
        </View>

        <View style={styles.statsGridTwo}>
          <StatCard icon={Package} label="Paletes" value={`${pallets.length}/12`} />
          <StatCard icon={Check} label="Total" value={load.total_count} tone="accent" />
        </View>

        <View style={styles.managementPanel}>
          <Text style={styles.sectionTitle}>Gerenciar carga</Text>
          <View style={styles.secondaryActionGrid}>
            <View style={styles.secondaryActionItem}>
              <PrimaryButton compact icon={Pencil} label="Editar" onPress={onEdit} variant="secondary" />
            </View>
            <View style={styles.secondaryActionItem}>
              <PrimaryButton
                compact
                disabled={!pallets.length || Boolean(busyMessage)}
                icon={FileText}
                label="PDF"
                loading={busyMessage === 'Gerando PDF'}
                onPress={onExport}
                variant="secondary"
              />
            </View>
            <View style={styles.secondaryActionItem}>
              <PrimaryButton compact icon={Trash2} label="Excluir" onPress={onDelete} variant="danger" />
            </View>
          </View>
        </View>

        {busyMessage ? (
          <View style={styles.busyBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.busyText}>{busyMessage}</Text>
          </View>
        ) : null}

        <PalletChart pallets={pallets} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Paletes</Text>

          {pallets.length === 0 ? (
            <EmptyState
              detail="Adicione uma foto por palete para contar com a IA."
              icon={Package}
              title="Sem paletes"
            />
          ) : (
            pallets.map((pallet) => (
              <Pressable
                key={pallet.id}
                onPress={() => onOpenPallet(pallet.id)}
                style={({ pressed }) => [styles.palletRow, { opacity: pressed ? 0.78 : 1 }]}
              >
                <RNImage
                  accessibilityLabel={`Foto de ${palletDisplayName(pallet)}`}
                  source={{
                    uri: imageDataUri(pallet.ai_image_base64 ?? pallet.original_image_base64),
                  }}
                  style={styles.palletThumb}
                />
                <View style={styles.palletRowBody}>
                  <Text style={styles.loadRowTitle} numberOfLines={1}>
                    {palletDisplayName(pallet)}
                  </Text>
                  <Text style={styles.loadRowMeta}>
                    IA {pallet.ai_count}
                    {pallet.manual_count !== null ? ` · ajuste ${pallet.manual_count}` : ''}
                  </Text>
                  <StatusPill status={pallet.status} />
                </View>
                <Text style={styles.palletFinal}>{pallet.final_count}</Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      <BottomActionBar>
        <PrimaryButton
          disabled={!canAdd}
          icon={Camera}
          label="Câmera"
          loading={busyMessage === 'Abrindo câmera'}
          onPress={onAddCamera}
        />
        <PrimaryButton
          disabled={!canAdd}
          icon={ImageIcon}
          label="Galeria"
          loading={busyMessage === 'Abrindo galeria'}
          onPress={onAddGallery}
          variant="secondary"
        />
      </BottomActionBar>
    </View>
  );
}

function StatusPill({ status }: { status: Pallet['status'] }) {
  const config = {
    processing: { label: 'Processando', bg: colors.warningSoft, fg: colors.accent },
    done: { label: 'Contado', bg: colors.successSoft, fg: colors.primary },
    error: { label: 'Erro', bg: colors.dangerSoft, fg: colors.danger },
  }[status];

  return (
    <View style={[styles.statusPill, { backgroundColor: config.bg }]}>
      <Text style={[styles.statusText, { color: config.fg }]}>{config.label}</Text>
    </View>
  );
}

function PalletScreen({
  load,
  pallet,
  busyMessage,
  onBack,
  onSaveManual,
  onNextPallet,
  onClearManual,
  onEditName,
  onRetry,
  onDelete,
  onOpenImage,
}: {
  load: Load;
  pallet: Pallet;
  busyMessage: string | null;
  onBack: () => void;
  onSaveManual: (value: number | null) => void;
  onNextPallet: (value: number | null) => void;
  onClearManual: () => void;
  onEditName: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onOpenImage: (imageUri: string) => void;
}) {
  const [manualText, setManualText] = useState(
    pallet.manual_count === null ? '' : String(pallet.manual_count),
  );

  useEffect(() => {
    setManualText(pallet.manual_count === null ? '' : String(pallet.manual_count));
  }, [pallet.id, pallet.manual_count]);

  const parseManualCount = () => {
    Keyboard.dismiss();

    const trimmed = manualText.trim();

    if (!trimmed) {
      return null;
    }

    const value = Number(trimmed);

    if (!Number.isInteger(value) || value < 0) {
      Alert.alert('Valor inválido', 'Informe um número inteiro maior ou igual a zero.');
      return undefined;
    }

    return value;
  };

  const goToNextPallet = () => {
    const value = parseManualCount();

    if (value === undefined) {
      return;
    }

    onNextPallet(value);
  };

  const palletImageUri = imageDataUri(pallet.ai_image_base64 ?? pallet.original_image_base64);

  return (
    <View style={styles.screenShell}>
      <ScrollView contentContainerStyle={styles.screenContentWithBottomBar}>
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} label="Voltar" onPress={onBack} />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={styles.kicker} numberOfLines={1}>
              {load.name}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {palletDisplayName(pallet)}
            </Text>
            <Text style={styles.loadRowMeta}>Palete {pallet.pallet_number}</Text>
          </View>
          <StatusPill status={pallet.status} />
        </View>

        <Pressable
          accessibilityLabel={`Ampliar foto de ${palletDisplayName(pallet)}`}
          accessibilityRole="imagebutton"
          disabled={!palletImageUri}
          onPress={() => {
            if (palletImageUri) {
              onOpenImage(palletImageUri);
            }
          }}
          style={({ pressed }) => [
            styles.detailImageFrame,
            { opacity: pressed && palletImageUri ? 0.88 : 1 },
          ]}
        >
          {palletImageUri ? (
            <RNImage
              accessibilityLabel={`Foto de ${palletDisplayName(pallet)}`}
              resizeMode="contain"
              source={{ uri: palletImageUri }}
              style={styles.detailImageContained}
            />
          ) : null}
        </Pressable>

        {busyMessage ? (
          <View style={styles.busyBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.busyText}>{busyMessage}</Text>
          </View>
        ) : null}

        {pallet.status === 'error' ? (
          <View style={styles.errorBox}>
            <AlertTriangle color={colors.danger} size={20} strokeWidth={2.2} />
            <Text style={styles.errorText}>{pallet.error_message}</Text>
          </View>
        ) : null}

        <View style={styles.statsGrid}>
          <StatCard icon={BarChart3} label="IA" value={pallet.ai_count} />
          <StatCard
            icon={Pencil}
            label="Manual"
            value={pallet.manual_count ?? '-'}
            tone="accent"
          />
          <StatCard icon={Check} label="Final" value={pallet.final_count} tone="blue" />
        </View>

        <View style={styles.managementPanel}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Nome do palete</Text>
            <PrimaryButton compact icon={Pencil} label="Editar" onPress={onEditName} variant="secondary" />
          </View>
          <Text style={styles.namePreview} numberOfLines={2}>
            {palletDisplayName(pallet)}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ajuste manual</Text>
          <TextInput
            blurOnSubmit
            keyboardType="number-pad"
            onChangeText={setManualText}
            onSubmitEditing={Keyboard.dismiss}
            placeholder="Contagem final"
            placeholderTextColor={colors.softText}
            returnKeyType="done"
            style={styles.input}
            value={manualText}
          />
          <View style={styles.secondaryActionGrid}>
            <View style={styles.secondaryActionItem}>
              <PrimaryButton compact icon={X} label="Limpar" onPress={onClearManual} variant="secondary" />
            </View>
            <View style={styles.secondaryActionItem}>
              <PrimaryButton compact icon={Trash2} label="Excluir" onPress={onDelete} variant="danger" />
            </View>
          </View>
        </View>
      </ScrollView>

      <BottomActionBar>
        <PrimaryButton icon={Plus} label="PrÃ³ximo palete" onPress={goToNextPallet} />
        <PrimaryButton
          disabled={Boolean(busyMessage)}
          icon={RefreshCw}
          label="Reprocessar"
          loading={busyMessage === 'Reprocessando IA'}
          onPress={onRetry}
          variant="secondary"
        />
      </BottomActionBar>
    </View>
  );
}

function LoadFormModal({
  state,
  onClose,
  onSave,
  saving = false,
}: {
  state: LoadModalState;
  onClose: () => void;
  onSave: (name: string, note: string | null) => void | Promise<void>;
  saving?: boolean;
}) {
  const isVisible = state.mode !== 'closed';
  const [name, setName] = useState(defaultLoadName());
  const [note, setNote] = useState('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (isVisible) {
      setName(state.mode === 'edit' ? state.load.name : defaultLoadName());
      setNote(state.mode === 'edit' ? state.load.note ?? '' : '');
    }
  }, [isVisible, state]);

  const save = () => {
    if (saving) {
      return;
    }

    Keyboard.dismiss();

    if (!name.trim()) {
      Alert.alert('Nome obrigatório', 'Dê um nome para a carga.');
      return;
    }

    onSave(name, note);
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={isVisible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.modalBackdrop,
          {
            paddingBottom: Math.max(insets.bottom, spacing.lg),
            paddingTop: Math.max(insets.top, spacing.lg),
          },
        ]}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {state.mode === 'edit' ? 'Editar carga' : 'Nova carga'}
            </Text>
            <IconButton disabled={saving} icon={X} label="Fechar" onPress={onClose} />
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.inputLabel}>Nome</Text>
            <TextInput
              blurOnSubmit
              editable={!saving}
              onChangeText={setName}
              onSubmitEditing={Keyboard.dismiss}
              placeholder="Carga"
              placeholderTextColor={colors.softText}
              returnKeyType="done"
              style={styles.input}
              value={name}
            />

            <Text style={styles.inputLabel}>Observação</Text>
            <TextInput
              blurOnSubmit
              editable={!saving}
              multiline
              numberOfLines={5}
              onChangeText={setNote}
              onSubmitEditing={Keyboard.dismiss}
              placeholder="Opcional"
              placeholderTextColor={colors.softText}
              returnKeyType="done"
              scrollEnabled={false}
              style={[styles.input, styles.noteInput]}
              submitBehavior="blurAndSubmit"
              value={note}
            />
          </ScrollView>

          <PrimaryButton
            disabled={saving}
            icon={Save}
            label="Salvar carga"
            loading={saving}
            onPress={save}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PalletNameModal({
  state,
  onClose,
  onSave,
  saving = false,
}: {
  state: PalletNameModalState;
  onClose: () => void;
  onSave: (name: string) => void | Promise<void>;
  saving?: boolean;
}) {
  const isVisible = state.mode !== 'closed';
  const fallbackName =
    state.mode === 'create'
      ? state.defaultName
      : state.mode === 'edit'
        ? palletDisplayName(state.pallet)
        : defaultPalletName(1);
  const [name, setName] = useState(fallbackName);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (isVisible) {
      setName(fallbackName);
    }
  }, [fallbackName, isVisible]);

  const save = () => {
    if (saving) {
      return;
    }

    Keyboard.dismiss();
    onSave(name.trim() || fallbackName);
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={isVisible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.modalBackdrop,
          {
            paddingBottom: Math.max(insets.bottom, spacing.lg),
            paddingTop: Math.max(insets.top, spacing.lg),
          },
        ]}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {state.mode === 'edit' ? 'Editar palete' : 'Nome do palete'}
            </Text>
            <IconButton disabled={saving} icon={X} label="Fechar" onPress={onClose} />
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.inputLabel}>Nome</Text>
            <TextInput
              autoFocus
              blurOnSubmit
              editable={!saving}
              onChangeText={setName}
              onSubmitEditing={save}
              placeholder="Palete"
              placeholderTextColor={colors.softText}
              returnKeyType="done"
              style={styles.input}
              value={name}
            />
          </ScrollView>

          <PrimaryButton
            disabled={saving}
            icon={Save}
            label={state.mode === 'edit' ? 'Salvar nome' : 'Continuar'}
            loading={saving}
            onPress={save}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ImageViewerModal({
  imageUri,
  onClose,
}: {
  imageUri: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(imageUri)}>
      <View style={styles.imageViewerBackdrop}>
        <Pressable
          accessibilityLabel="Fechar imagem"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.imageViewerTapTarget}
        />

        {imageUri ? (
          <View pointerEvents="none" style={styles.imageViewerContent}>
            <RNImage
              resizeMode="contain"
              source={{ uri: imageUri }}
              style={styles.imageViewerImage}
            />
          </View>
        ) : null}

        <View
          style={[
            styles.imageViewerClose,
            {
              top: Math.max(insets.top, spacing.lg),
            },
          ]}
        >
          <IconButton icon={X} label="Fechar imagem" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
  const [loads, setLoads] = useState<LoadSummary[]>([]);
  const [currentLoad, setCurrentLoad] = useState<Load | null>(null);
  const [pallets, setPallets] = useState<Pallet[]>([]);
  const [currentPallet, setCurrentPallet] = useState<Pallet | null>(null);
  const [loadModal, setLoadModal] = useState<LoadModalState>({ mode: 'closed' });
  const [palletNameModal, setPalletNameModal] = useState<PalletNameModalState>({
    mode: 'closed',
  });
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);
  const [loadSubmitting, setLoadSubmitting] = useState(false);
  const [palletNameSubmitting, setPalletNameSubmitting] = useState(false);
  const loadSubmittingRef = useRef(false);
  const palletNameSubmittingRef = useRef(false);
  const pickerFlowLockedRef = useRef(false);
  const retryInFlightRef = useRef(false);

  const releasePickerFlow = useCallback(() => {
    pickerFlowLockedRef.current = false;
  }, []);

  const closePalletNameModal = useCallback(() => {
    setPalletNameModal((state) => {
      if (state.mode === 'create') {
        releasePickerFlow();
      }

      return { mode: 'closed' };
    });
    palletNameSubmittingRef.current = false;
    setPalletNameSubmitting(false);
  }, [releasePickerFlow]);

  const navigateTo = useCallback(
    (nextScreen: Screen) => {
      setScreenHistory((history) => [...history, screen]);
      setScreen(nextScreen);
    },
    [screen],
  );

  const replaceScreen = useCallback(
    (nextScreen: Screen) => {
      setScreenHistory((history) => {
        const withoutCurrent = history.filter((entry) => !screensEqual(entry, screen));
        const last = withoutCurrent[withoutCurrent.length - 1];

        if (last && screensEqual(last, nextScreen)) {
          return withoutCurrent.slice(0, -1);
        }

        return withoutCurrent;
      });
      setScreen(nextScreen);
    },
    [screen],
  );

  const goBack = useCallback(() => {
    if (imageViewerUri) {
      setImageViewerUri(null);
      return true;
    }

    if (loadModal.mode !== 'closed') {
      setLoadModal({ mode: 'closed' });
      return true;
    }

    if (palletNameModal.mode !== 'closed') {
      closePalletNameModal();
      return true;
    }

    if (screenHistory.length > 0) {
      const previousScreen = screenHistory[screenHistory.length - 1];
      setScreenHistory(screenHistory.slice(0, -1));
      setScreen(previousScreen);
      return true;
    }

    if (screen.name !== 'home') {
      setScreen({ name: 'home' });
      return true;
    }

    return false;
  }, [
    closePalletNameModal,
    imageViewerUri,
    loadModal.mode,
    palletNameModal.mode,
    screen,
    screenHistory,
  ]);

  const refreshHome = useCallback(async () => {
    const rows = await listLoads();
    setLoads(rows);
  }, []);

  const refreshLoad = useCallback(async (loadId: number) => {
    const [load, loadPallets] = await Promise.all([getLoad(loadId), listPallets(loadId)]);
    setCurrentLoad(load ?? null);
    setPallets(loadPallets);
  }, []);

  const refreshPallet = useCallback(async (loadId: number, palletId: number) => {
    const [load, pallet] = await Promise.all([getLoad(loadId), getPallet(palletId)]);
    setCurrentLoad(load ?? null);
    setCurrentPallet(pallet ?? null);
  }, []);

  const refreshCurrentScreen = useCallback(async () => {
    if (screen.name === 'home') {
      await refreshHome();
    } else if (screen.name === 'load') {
      await refreshLoad(screen.loadId);
    } else {
      await refreshPallet(screen.loadId, screen.palletId);
    }
  }, [refreshHome, refreshLoad, refreshPallet, screen]);

  useEffect(() => {
    async function boot() {
      try {
        await initDatabase();
        await refreshHome();
        setReady(true);
      } catch (error) {
        Alert.alert('Erro ao iniciar', errorMessage(error));
      }
    }

    boot();
  }, [refreshHome]);

  useEffect(() => {
    if (ready) {
      refreshCurrentScreen().catch((error) => {
        Alert.alert('Erro ao carregar', errorMessage(error));
      });
    }
  }, [ready, refreshCurrentScreen]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);

    return () => {
      subscription.remove();
    };
  }, [goBack]);

  const handleSaveLoad = async (name: string, note: string | null) => {
    if (loadSubmittingRef.current) {
      return;
    }

    loadSubmittingRef.current = true;
    setLoadSubmitting(true);

    try {
      if (loadModal.mode === 'edit') {
        await updateLoad(loadModal.load.id, name, note);
        setLoadModal({ mode: 'closed' });
        await refreshCurrentScreen();
        return;
      }

      const loadId = await createLoad(name, note);
      setLoadModal({ mode: 'closed' });
      navigateTo({ name: 'load', loadId });
    } catch (error) {
      Alert.alert('Erro ao salvar', errorMessage(error));
    } finally {
      loadSubmittingRef.current = false;
      setLoadSubmitting(false);
    }
  };

  const handleDeleteLoad = () => {
    if (!currentLoad) {
      return;
    }

    Alert.alert('Excluir carga', `Excluir ${currentLoad.name}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLoad(currentLoad.id);
            replaceScreen({ name: 'home' });
          } catch (error) {
            Alert.alert('Erro ao excluir', errorMessage(error));
          }
        },
      },
    ]);
  };

  const requestPalletImage = (source: ImageSource) => {
    if (screen.name !== 'load') {
      return;
    }

    if (busyMessage || pickerFlowLockedRef.current || palletNameModal.mode !== 'closed') {
      return;
    }

    pickerFlowLockedRef.current = true;

    setPalletNameModal({
      mode: 'create',
      source,
      loadId: screen.loadId,
      defaultName: nextPalletName(pallets),
    });
  };

  const processPickedAsset = useCallback(
    async (context: PendingPickerContext, asset: ImagePicker.ImagePickerAsset) => {
      let palletId: number | null = null;
      let gallerySaveError: string | null = null;

      try {
        if (!asset.base64) {
          throw new Error('A foto nao retornou em base64.');
        }

        if (context.source === 'camera') {
          setBusyMessage('Salvando na galeria');
          try {
            await saveCameraCaptureToGallery(asset.uri);
          } catch (error) {
            gallerySaveError = errorMessage(error);
          }
        }

        setBusyMessage('Salvando palete');
        palletId = await createProcessingPallet(context.loadId, asset.base64, context.palletName);
        await clearPendingPickerContext();
        await refreshLoad(context.loadId);

        setBusyMessage('Contando com IA');
        const analysis = await analyzePalletImage(asset.base64);
        await savePalletAnalysis(palletId, context.loadId, analysis);
        navigateTo({ name: 'pallet', loadId: context.loadId, palletId });

        if (gallerySaveError) {
          Alert.alert(
            'Foto nao salva na galeria',
            `O palete foi contado normalmente, mas a foto da camera nao foi salva na galeria. ${gallerySaveError}`,
          );
        }
      } catch (error) {
        const message = errorMessage(error);

        if (palletId) {
          await markPalletError(palletId, context.loadId, message);
          navigateTo({ name: 'pallet', loadId: context.loadId, palletId });
        } else {
          Alert.alert('Nao foi possivel adicionar', message);
        }
      } finally {
        await clearPendingPickerContext().catch(() => undefined);
        setBusyMessage(null);
        releasePickerFlow();
        await refreshCurrentScreen().catch(() => undefined);
      }
    },
    [navigateTo, refreshCurrentScreen, refreshLoad, releasePickerFlow],
  );

  const pickImageSafely = useCallback(
    async (context: PendingPickerContext) => {
      let handedOffToProcessor = false;

      try {
        setBusyMessage(context.source === 'camera' ? 'Abrindo camera' : 'Abrindo galeria');

        if (context.source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            throw new Error('Permita o uso da camera para fotografar o palete.');
          }
        }

        await savePendingPickerContext(context);
        await waitForPickerLaunchWindow();

        const result =
          context.source === 'camera'
            ? await ImagePicker.launchCameraAsync({
                allowsEditing: false,
                base64: true,
                mediaTypes: ['images'],
                quality: 0.72,
              })
            : await ImagePicker.launchImageLibraryAsync({
                allowsEditing: false,
                base64: true,
                mediaTypes: ['images'],
                quality: 0.72,
              });

        if (result.canceled) {
          await clearPendingPickerContext();
          return;
        }

        const asset = result.assets[0];
        if (!asset) {
          throw new Error('Nenhuma imagem foi selecionada.');
        }

        handedOffToProcessor = true;
        await processPickedAsset(context, asset);
      } catch (error) {
        await clearPendingPickerContext().catch(() => undefined);
        Alert.alert('Nao foi possivel adicionar', errorMessage(error));
      } finally {
        if (!handedOffToProcessor) {
          setBusyMessage(null);
          releasePickerFlow();
          await refreshCurrentScreen().catch(() => undefined);
        }
      }
    },
    [processPickedAsset, refreshCurrentScreen, releasePickerFlow],
  );

  const recoverPendingPickerResult = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    const context = await getPendingPickerContext();
    if (!context) {
      return;
    }

    const result = await ImagePicker.getPendingResultAsync();

    if (!result) {
      await clearPendingPickerContext();
      return;
    }

    if (isImagePickerErrorResult(result)) {
      await clearPendingPickerContext();
      Alert.alert('Nao foi possivel adicionar', result.message);
      return;
    }

    if (result.canceled) {
      await clearPendingPickerContext();
      return;
    }

    const asset = result.assets[0];
    if (!asset) {
      await clearPendingPickerContext();
      Alert.alert('Nao foi possivel adicionar', 'Nenhuma imagem foi selecionada.');
      return;
    }

    pickerFlowLockedRef.current = true;
    await processPickedAsset(context, asset);
  }, [processPickedAsset]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    recoverPendingPickerResult().catch((error) => {
      Alert.alert('Nao foi possivel recuperar a imagem', errorMessage(error));
    });
  }, [ready, recoverPendingPickerResult]);

  const handleSavePalletName = async (name: string) => {
    if (palletNameModal.mode === 'closed') {
      return;
    }

    if (palletNameSubmittingRef.current) {
      return;
    }

    palletNameSubmittingRef.current = true;
    setPalletNameSubmitting(true);

    const state = palletNameModal;
    setPalletNameModal({ mode: 'closed' });

    try {
      if (state.mode === 'create') {
        palletNameSubmittingRef.current = false;
        setPalletNameSubmitting(false);
        await pickImageSafely({
          loadId: state.loadId,
          source: state.source,
          palletName: name,
        });
        return;
      }

      await updatePalletName(state.pallet.id, name);
      await refreshPallet(state.pallet.load_id, state.pallet.id);
      if (screen.name === 'load') {
        await refreshLoad(state.pallet.load_id);
      }
    } catch (error) {
      Alert.alert('Erro ao renomear', errorMessage(error));
    } finally {
      palletNameSubmittingRef.current = false;
      setPalletNameSubmitting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!currentLoad) {
      return;
    }

    if (busyMessage) {
      return;
    }

    if (!pallets.length) {
      Alert.alert('Sem paletes', 'Adicione paletes antes de exportar o PDF.');
      return;
    }

    try {
      setBusyMessage('Gerando PDF');
      await shareLoadPdf(currentLoad, pallets);
    } catch (error) {
      Alert.alert('Erro no PDF', errorMessage(error));
    } finally {
      setBusyMessage(null);
    }
  };

  const handleSaveManual = async (manualCount: number | null) => {
    if (!currentPallet) {
      return false;
    }

    try {
      await updatePalletManualCount(currentPallet.id, currentPallet.load_id, manualCount);
      await refreshPallet(currentPallet.load_id, currentPallet.id);
      return true;
    } catch (error) {
      Alert.alert('Erro ao ajustar', errorMessage(error));
      return false;
    }
  };

  const handleNextPallet = async (manualCount: number | null) => {
    if (!currentPallet) {
      return;
    }

    const loadId = currentPallet.load_id;
    const saved = await handleSaveManual(manualCount);

    if (saved) {
      replaceScreen({ name: 'load', loadId });
    }
  };

  const handleRetryPallet = async () => {
    if (!currentPallet) {
      return;
    }

    if (retryInFlightRef.current || busyMessage) {
      return;
    }

    retryInFlightRef.current = true;

    try {
      setBusyMessage('Reprocessando IA');
      await resetPalletForProcessing(currentPallet.id);
      await refreshPallet(currentPallet.load_id, currentPallet.id);
      const analysis = await analyzePalletImage(currentPallet.original_image_base64);
      await savePalletAnalysis(currentPallet.id, currentPallet.load_id, analysis);
      await refreshPallet(currentPallet.load_id, currentPallet.id);
    } catch (error) {
      const message = errorMessage(error);
      await markPalletError(currentPallet.id, currentPallet.load_id, message);
      await refreshPallet(currentPallet.load_id, currentPallet.id);
      Alert.alert('Erro ao reprocessar', message);
    } finally {
      retryInFlightRef.current = false;
      setBusyMessage(null);
    }
  };

  const handleDeletePallet = () => {
    if (!currentPallet) {
      return;
    }

    Alert.alert('Excluir palete', `Excluir ${palletDisplayName(currentPallet)}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            const loadId = currentPallet.load_id;
            await deletePallet(currentPallet.id, loadId);
            replaceScreen({ name: 'load', loadId });
          } catch (error) {
            Alert.alert('Erro ao excluir', errorMessage(error));
          }
        },
      },
    ]);
  };

  let content = (
    <View style={styles.loadingScreen}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.busyText}>Carregando</Text>
    </View>
  );

  if (ready) {
    if (screen.name === 'home') {
      content = (
        <HomeScreen
          loads={loads}
          onCreate={() => setLoadModal({ mode: 'create' })}
          onOpen={(loadId) => navigateTo({ name: 'load', loadId })}
        />
      );
    } else if (screen.name === 'load' && currentLoad) {
      content = (
        <LoadScreen
          busyMessage={busyMessage}
          load={currentLoad}
          onAddCamera={() => requestPalletImage('camera')}
          onAddGallery={() => requestPalletImage('gallery')}
          onBack={goBack}
          onDelete={handleDeleteLoad}
          onEdit={() => setLoadModal({ mode: 'edit', load: currentLoad })}
          onExport={handleExportPdf}
          onOpenPallet={(palletId) =>
            navigateTo({ name: 'pallet', loadId: currentLoad.id, palletId })
          }
          pallets={pallets}
        />
      );
    } else if (screen.name === 'pallet' && currentLoad && currentPallet) {
      content = (
        <PalletScreen
          busyMessage={busyMessage}
          load={currentLoad}
          onBack={goBack}
          onClearManual={() => handleSaveManual(null)}
          onDelete={handleDeletePallet}
          onEditName={() => setPalletNameModal({ mode: 'edit', pallet: currentPallet })}
          onNextPallet={handleNextPallet}
          onOpenImage={setImageViewerUri}
          onRetry={handleRetryPallet}
          onSaveManual={handleSaveManual}
          pallet={currentPallet}
        />
      );
    }
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.app}>
        <StatusBar style="dark" />
        {content}
        <LoadFormModal
          onClose={() => setLoadModal({ mode: 'closed' })}
          onSave={handleSaveLoad}
          saving={loadSubmitting}
          state={loadModal}
        />
        <PalletNameModal
          onClose={closePalletNameModal}
          onSave={handleSavePalletName}
          saving={palletNameSubmitting}
          state={palletNameModal}
        />
        <ImageViewerModal
          imageUri={imageViewerUri}
          onClose={() => setImageViewerUri(null)}
        />
      </View>
    </SafeAreaProvider>
  );
}

const buttonVariants = {
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    color: colors.surface,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    color: colors.ink,
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
    color: colors.surface,
  },
  ghost: {
    backgroundColor: colors.surfaceWarm,
    borderColor: colors.border,
    color: colors.primaryDark,
  },
};

const styles = StyleSheet.create({
  app: {
    backgroundColor: colors.background,
    flex: 1,
  },
  bottomActionBar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  busyBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  busyText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexShrink: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  buttonCompact: {
    flex: 0,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  buttonText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  chartBar: {
    borderRadius: 4,
    width: '100%',
  },
  chartBox: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 176,
    padding: spacing.md,
  },
  chartEmpty: {
    alignSelf: 'center',
    color: colors.softText,
    flex: 1,
    textAlign: 'center',
  },
  chartItem: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartLabel: {
    color: colors.softText,
    fontSize: 10,
    fontWeight: '700',
    maxWidth: 48,
  },
  chartTrack: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: 5,
    height: 108,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  chartValue: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  detailImageContained: {
    height: '100%',
    width: '100%',
  },
  detailImageFrame: {
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.md,
    height: 320,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  empty: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyDetail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  errorBox: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderColor: '#F3B5AB',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hero: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  heroText: {
    flex: 1,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  imageViewerBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    flex: 1,
  },
  imageViewerClose: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 3,
  },
  imageViewerContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 72,
    zIndex: 1,
  },
  imageViewerImage: {
    height: '100%',
    width: '100%',
  },
  imageViewerTapTarget: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 0,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: spacing.xs,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  loadingScreen: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
  loadRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.md,
  },
  loadRowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  loadRowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  loadRowIcon: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  loadRowMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  loadRowStack: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  loadRowTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
  },
  loadRowTotal: {
    color: colors.primaryDark,
    fontSize: 26,
    fontWeight: '900',
  },
  loadMetric: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  loadMetricLabel: {
    color: colors.softText,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  loadMetricsRow: {
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  loadMetricValue: {
    color: colors.primaryDark,
    fontSize: 22,
    fontWeight: '900',
  },
  managementPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 51, 0.28)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    maxHeight: '84%',
    maxWidth: 520,
    padding: spacing.lg,
    width: '100%',
  },
  modalScrollContent: {
    paddingBottom: spacing.md,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '900',
  },
  namePreview: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  noteInput: {
    minHeight: 132,
    paddingBottom: spacing.md,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  noteText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  palletChart: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  palletChartBar: {
    borderRadius: 4,
    height: '100%',
  },
  palletChartItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 26,
  },
  palletChartLabel: {
    color: colors.softText,
    fontSize: 11,
    fontWeight: '900',
    width: 24,
  },
  palletChartTrack: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: 4,
    flex: 1,
    height: 10,
    overflow: 'hidden',
  },
  palletFinal: {
    color: colors.primaryDark,
    fontSize: 24,
    fontWeight: '900',
  },
  palletRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
  },
  palletRowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  palletThumb: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    height: 64,
    width: 64,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingTop: Platform.select({ android: 44, default: spacing.xxl }),
  },
  screenContentWithBottomBar: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: 112,
    paddingTop: Platform.select({ android: 44, default: spacing.xxl }),
  },
  screenShell: {
    backgroundColor: colors.background,
    flex: 1,
  },
  secondaryActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  secondaryActionItem: {
    flexBasis: 96,
    flexGrow: 1,
    minWidth: 0,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    minWidth: '47%',
    minHeight: 112,
    padding: spacing.md,
  },
  statIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  statLabel: {
    color: colors.softText,
    fontSize: 12,
    fontWeight: '800',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsGridTwo: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statValue: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '900',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 36,
  },
  totalBadge: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderColor: '#C9E3D5',
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: 96,
    padding: spacing.md,
  },
  totalBadgeLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
  },
  totalBadgeValue: {
    color: colors.primaryDark,
    fontSize: 34,
    fontWeight: '900',
  },
});
