// Settings in sections (docs/settings.md): the title and the section menu around each section's page.
import { SettingsNav } from "@/dashboard/components/settingsNav";
import { sectionMenu } from "@/dashboard/settings-sections";
import { extensions } from "@/core/extensions";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const menu = sectionMenu(extensions.settingsSections.map(({ slug, label, hint }) => ({ slug, label, hint })));
  return (
    <div className="stack">
      <h1 className="h1">Settings</h1>
      <div className="set-wrap">
        <SettingsNav sections={menu} />
        <div className="set-body">{children}</div>
      </div>
    </div>
  );
}
