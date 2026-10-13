import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../../services/api';
import { API_ENDPOINTS } from '../../utils/constants';
import { COLORS, SHADOWS, SPACING, TYPOGRAPHY } from '../../utils/colors';
import { formatDate, formatNumber } from '../../utils/format';
import { ScreenContainer } from '../../components/ScreenContainer';

const toIsoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateFromIso = (value) => { const [year, month, day] = String(value).split('-').map(Number); return new Date(year, month - 1, day); };
const addDays = (value, days) => { const date = dateFromIso(value); date.setDate(date.getDate() + days); return toIsoDate(date); };
const indiaTodayIso = () => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch (_) { return toIsoDate(new Date()); }
};
const mondayFor = (value) => { const date = dateFromIso(value); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return toIsoDate(date); };
const monthFor = (value) => String(value).slice(0, 7);
const moveMonth = (month, offset) => { const [year, monthNumber] = month.split('-').map(Number); return toIsoDate(new Date(year, monthNumber - 1 + offset, 1)).slice(0, 7); };
const monthBounds = (month) => { const [year, monthNumber] = month.split('-').map(Number); return { fromDate: `${month}-01`, toDate: toIsoDate(new Date(year, monthNumber, 0)) }; };

// Reuses the desktop category endpoint and its SQL-backed aggregation. No
// attendance classification or sample data is created in mobile.
export const HRAnalyticsScreen = () => {
  const today = useMemo(indiaTodayIso, []);
  const [mode, setMode] = useState('daily');
  const [dailyDate, setDailyDate] = useState(today);
  const [weekStart, setWeekStart] = useState(mondayFor(today));
  const [month, setMonth] = useState(monthFor(today));
  const [analytics, setAnalytics] = useState(null);
  const [departmentNames, setDepartmentNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    if (mode === 'daily') return { fromDate: dailyDate, toDate: dailyDate };
    if (mode === 'weekly') return { fromDate: weekStart, toDate: addDays(weekStart, 6) };
    return monthBounds(month);
  }, [dailyDate, mode, month, weekStart]);

  const loadAnalytics = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [summary, filters] = await Promise.all([
        api.get(API_ENDPOINTS.HR_CATEGORY_ANALYTICS, { mode, ...range }),
        api.get(API_ENDPOINTS.HR_FILTERS),
      ]);
      const names = Object.fromEntries((filters?.departments || []).map((department) => {
        const code = String(department.code || '').trim();
        return [code, String(department.name || '').trim() || code];
      }).filter(([code]) => code));
      setDepartmentNames(names);
      setAnalytics(summary);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load category analytics.');
      setAnalytics(null);
    } finally { setLoading(false); }
  }, [mode, range]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  const departments = analytics?.departments || [];
  const maximum = Math.max(1, ...departments.flatMap((item) => [Number(item.complete || 0), Number(item.absent || 0)]));
  const periodLabel = mode === 'daily'
    ? formatDate(range.fromDate)
    : mode === 'weekly'
      ? `${formatDate(range.fromDate, { year: undefined })} – ${formatDate(range.toDate)}`
      : new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const previous = () => { if (mode === 'daily') setDailyDate(addDays(dailyDate, -1)); else if (mode === 'weekly') setWeekStart(addDays(weekStart, -7)); else setMonth(moveMonth(month, -1)); };
  const next = () => { if (mode === 'daily') setDailyDate(addDays(dailyDate, 1)); else if (mode === 'weekly') setWeekStart(addDays(weekStart, 7)); else setMonth(moveMonth(month, 1)); };

  return <ScreenContainer title="Category Analytics" showHeader>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.modeTabs}>{['daily', 'weekly', 'monthly'].map((item) => <TouchableOpacity key={item} onPress={() => setMode(item)} style={[styles.modeTab, mode === item && styles.modeTabActive]}><Text style={[styles.modeText, mode === item && styles.modeTextActive]}>{item[0].toUpperCase() + item.slice(1)}</Text></TouchableOpacity>)}</View>
      <View style={[styles.periodCard, SHADOWS.sm]}>
        <Text style={[styles.periodHint, TYPOGRAPHY.caption]}>{mode === 'daily' ? 'Attendance date' : mode === 'weekly' ? 'Week (Monday to Sunday)' : 'Attendance month'}</Text>
        <View style={styles.periodControls}><TouchableOpacity accessibilityLabel="Previous period" onPress={previous} style={styles.arrowButton}><Text style={styles.arrowText}>‹</Text></TouchableOpacity><Text style={styles.periodValue}>{periodLabel}</Text><TouchableOpacity accessibilityLabel="Next period" onPress={next} style={styles.arrowButton}><Text style={styles.arrowText}>›</Text></TouchableOpacity></View>
        <TouchableOpacity onPress={() => { setDailyDate(today); setWeekStart(mondayFor(today)); setMonth(monthFor(today)); }}><Text style={styles.todayLink}>Reset to current period</Text></TouchableOpacity>
      </View>
      {loading ? <View style={styles.state}><ActivityIndicator color={COLORS.primary} /><Text style={styles.stateText}>Loading real attendance data…</Text></View> : null}
      {!loading && error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><TouchableOpacity onPress={loadAnalytics}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : null}
      {!loading && analytics ? <>
        <View style={styles.summaryGrid}><Metric label="Punched" value={analytics.punched} color={COLORS.primary} /><Metric label="Absent" value={analytics.absent} color={COLORS.absent} /><Metric label="Miss Punch" value={analytics.miss} color={COLORS.missPunch} /><Metric label="Late" value={analytics.late} color={COLORS.late} /></View>
        <View style={[styles.chartCard, SHADOWS.sm]}>
          <Text style={styles.sectionTitle}>Department-wise Attendance</Text><Text style={styles.sectionSubtitle}>Present and Absent employees · {periodLabel}</Text>
          <View style={styles.legend}><Legend color={COLORS.present} label="Present" /><Legend color={COLORS.absent} label="Absent" /></View>
          {departments.length ? departments.map((department) => { const code = String(department.departmentcode || '').trim(); const present = Number(department.complete || 0); const absent = Number(department.absent || 0); return <View key={code || 'unassigned'} style={styles.departmentRow}><Text numberOfLines={1} style={styles.departmentName}>{departmentNames[code] || code || 'Unassigned'}</Text><Bar color={COLORS.present} value={present} maximum={maximum} label="Present" /><Bar color={COLORS.absent} value={absent} maximum={maximum} label="Absent" /></View>; }) : <Text style={styles.emptyText}>No department attendance data for this period.</Text>}
        </View>
        <View style={[styles.detailCard, SHADOWS.sm]}><Text style={styles.sectionTitle}>Department Summary</Text>{departments.map((department) => { const code = String(department.departmentcode || '').trim(); return <View key={`summary-${code || 'unassigned'}`} style={styles.detailRow}><Text numberOfLines={1} style={styles.detailName}>{departmentNames[code] || code || 'Unassigned'}</Text><Text style={[styles.detailValue, { color: COLORS.present }]}>P {formatNumber(department.complete || 0)}</Text><Text style={[styles.detailValue, { color: COLORS.absent }]}>A {formatNumber(department.absent || 0)}</Text></View>; })}</View>
      </> : null}
    </ScrollView>
  </ScreenContainer>;
};

const Metric = ({ label, value, color }) => <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{formatNumber(value || 0)}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
const Legend = ({ color, label }) => <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
const Bar = ({ color, value, maximum, label }) => <View style={styles.barLine}><Text style={styles.barLabel}>{label}</Text><View style={styles.barTrack}><View style={[styles.barFill, { backgroundColor: color, width: `${Math.max(0, Math.min(100, Number(value || 0) / maximum * 100))}%` }]} /></View><Text style={styles.barValue}>{formatNumber(value || 0)}</Text></View>;

const styles = StyleSheet.create({
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.lg },
  modeTabs: { flexDirection: 'row', backgroundColor: COLORS.surfaceVariant, padding: 4, borderRadius: 12 }, modeTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 }, modeTabActive: { backgroundColor: COLORS.primary }, modeText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' }, modeTextActive: { color: COLORS.textOnPrimary },
  periodCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' }, periodHint: { color: COLORS.textSecondary }, periodControls: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: SPACING.sm }, periodValue: { flex: 1, textAlign: 'center', color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' }, arrowButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.surfaceVariant, alignItems: 'center', justifyContent: 'center' }, arrowText: { color: COLORS.primary, fontSize: 28, lineHeight: 30 }, todayLink: { color: COLORS.primary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  state: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.sm }, stateText: { color: COLORS.textSecondary, fontSize: 13 }, errorCard: { backgroundColor: COLORS.error + '12', borderColor: COLORS.error + '30', borderWidth: 1, borderRadius: 14, padding: SPACING.lg, alignItems: 'center', gap: SPACING.sm }, errorText: { color: COLORS.error, textAlign: 'center', fontSize: 13 }, retryText: { color: COLORS.primary, fontWeight: '700' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }, metric: { width: '48.5%', minHeight: 82, padding: SPACING.md, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center' }, metricValue: { fontSize: 24, fontWeight: '800' }, metricLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 4 },
  chartCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }, detailCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border }, sectionTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' }, sectionSubtitle: { color: COLORS.textSecondary, fontSize: 11, marginTop: 3 }, legend: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, legendDot: { width: 8, height: 8, borderRadius: 4 }, legendText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  departmentRow: { paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.divider, gap: 5 }, departmentName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 2 }, barLine: { flexDirection: 'row', alignItems: 'center', gap: 7 }, barLabel: { color: COLORS.textSecondary, fontSize: 10, width: 43 }, barTrack: { flex: 1, height: 7, backgroundColor: COLORS.surfaceVariant, borderRadius: 4, overflow: 'hidden' }, barFill: { height: '100%', borderRadius: 4 }, barValue: { color: COLORS.textPrimary, fontSize: 11, width: 30, textAlign: 'right', fontWeight: '700' },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.divider, gap: 8 }, detailName: { flex: 1, color: COLORS.textPrimary, fontSize: 12, fontWeight: '600' }, detailValue: { fontSize: 12, fontWeight: '700' }, emptyText: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: SPACING.lg },
});
