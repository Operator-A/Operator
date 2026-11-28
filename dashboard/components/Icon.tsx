import {
  Activity, Bell, BookOpen, Bot, Brain, Calculator, ChartLine, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, Clapperboard, ClipboardList, Clock, Coffee, CreditCard, Compass, Cpu, Database, FileText,
  Flame, FlaskConical, GitBranch, GitPullRequest, Globe, Handshake, History, Inbox, Landmark, LayoutDashboard, Leaf, List, Lock, LogOut, Mail, Package, Megaphone, Menu, MessageCircle, Moon, Pencil, Play,
  Plug, Plus, Power, Receipt, Settings, ShieldAlert, ShieldCheck, Send, ShoppingBag, SlidersHorizontal, Store, Sun, ThumbsDown, ThumbsUp, Trash2, UserPlus, Users, X, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  activity: Activity, bell: Bell, "book-open": BookOpen, bot: Bot, brain: Brain, calculator: Calculator, "chart-line": ChartLine, calendar: Calendar, check: Check, "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "chevron-up": ChevronUp, "circle-alert": CircleAlert,
  clapperboard: Clapperboard, "clipboard-list": ClipboardList, clock: Clock, coffee: Coffee, "credit-card": CreditCard, compass: Compass, cpu: Cpu, database: Database,
  "file-text": FileText, flame: Flame, "flask-conical": FlaskConical, "git-branch": GitBranch, "git-pull-request": GitPullRequest, globe: Globe, handshake: Handshake, history: History,
  inbox: Inbox, landmark: Landmark, "layout-dashboard": LayoutDashboard, leaf: Leaf, list: List, lock: Lock, "log-out": LogOut, mail: Mail, package: Package, megaphone: Megaphone, menu: Menu, "message-circle": MessageCircle,
  moon: Moon, pencil: Pencil, play: Play, plug: Plug, plus: Plus, power: Power, receipt: Receipt, settings: Settings, "shield-alert": ShieldAlert, "shield-check": ShieldCheck,
  send: Send, "shopping-bag": ShoppingBag, "sliders-horizontal": SlidersHorizontal, store: Store, sun: Sun, "thumbs-down": ThumbsDown, "thumbs-up": ThumbsUp, "trash-2": Trash2, "user-plus": UserPlus, users: Users, x: X,
};

export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const C = ICONS[name] ?? CircleAlert;
  return <C size={size} strokeWidth={1.75} className={className} style={style} aria-hidden />;
}
