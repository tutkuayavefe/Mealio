# AI Agent Team Template

Bu depo, farklı yazılım projelerine uyarlanabilen bir VS Code agent takımı şablonudur. `AGENTS.md` genel çalışma akışını tanımlar; `.github/agents/` rol tanımlarını; `.github/skills/` ise seçili işlere ait tekrar kullanılabilir yönergeleri içerir. Bu depoda örnek ürün uygulaması yoktur; şablon proje bağlamı ve agent altyapısı sağlar.

## Takım rolleri

| Rol | Sorumluluk | Çıktı |
|---|---|---|
| `team-lead` | İşi koordine eder, uygun uzmanları çağırır, entegrasyon ve son raporu üstlenir | Uygulanmış ve gözden geçirilmiş değişiklik |
| `product-planner` | Ürün problemini ve istek kapsamını netleştirir | Kullanıcı hikâyeleri, kabul ölçütleri, varsayımlar ve etkilenen alanlar |
| `frontend-engineer` | Mevcut teknoloji yığınıyla kullanıcı arayüzü ve istemci davranışlarını geliştirir | Frontend kodu ve kendi değişikliklerine dair doğrulama |
| `backend-engineer` | Mevcut yığınla sunucu, API, veri modeli ve entegrasyonları geliştirir | Backend kodu ve kendi değişikliklerine dair doğrulama |
| `qa-engineer` | Kabul ölçütleri için test ekler/günceller ve ilgili kontrolleri çalıştırır | Test değişiklikleri, komutlar ve sonuçlar |
| `quality-reviewer` | Uygulama ve test diff'ini bağımsız inceler; kod düzenlemez | Dosya/satır referanslı bulgular veya bulgu yok raporu |
| `security-guardian` | Kullanıcı verisi, hesapları, gizliliği veya dış sistemleri etkileyen önemli eylemleri salt okunur değerlendirir | Risk sınıfı, etki ve güvenli seçenek; kullanıcı adına izin veremez |

## Önerilen akış

1. `AI Agent Team Template.code-workspace` VS Code'da açılır; Agent menüsünden `team-lead` seçilir ve istek verilir.
2. Gereksinimler belirsiz veya kapsamlıysa `product-planner` kabul ölçütleri hazırlar; takım lideri bu ölçütleri geliştiricilere aktarır.
3. Değişikliğe göre frontend, backend veya ikisi görevlendirilir. Aynı dosyayı birden fazla agent eş zamanlı düzenlemez.
4. Kod değişikliklerinden sonra `qa-engineer` uygun testleri ekler veya günceller ve proje test komutlarını çalıştırır.
5. `quality-reviewer` diff'i bağımsız inceler. Bulgular ilgili geliştiriciye döner; takım lideri düzeltmeleri birleştirip son durumu raporlar.
6. Push, deploy, silme, erişim/izin değişikliği, mesaj gönderme, yayınlama veya benzeri önemli bir eylemden önce `security-guardian` risk incelemesi yapar. İnceleme kullanıcı onayı değildir; takım lideri aynı eylem ve hedef için kullanıcıdan açık onay almadan ilerlemez.

Her işte bütün roller kullanılmaz. Örneğin salt belge değişikliğinde frontend/backend agent'ı gerekmeyebilir. İstek çok açık ve dar kapsamlıysa planner atlanabilir; test edilebilir kod değişikliği varsa QA ve review adımları akışta tutulur.

## QA ve kod incelemesi neden ayrı?

QA davranışı kabul ölçütlerine göre doğrular: test yazar/günceller, komutları çalıştırır ve başarısızlıkları raporlar. Reviewer kodun doğruluğu, regresyon, güvenlik ve bakım risklerini inceler; test komutlarını çalıştırdığı iddiasında bulunmaz ve dosya düzenlemez. Bu ayrım, test yazan agent'ın aynı değişikliği tek başına onaylamasını önler.

## VS Code kullanımı

Agent tanımları `.github/agents/*.agent.md` biçimindedir. Proje klasörünü VS Code'da açıp Agent menüsünden `team-lead` seçin. Ardından özelliği veya düzeltmeyi normal sohbet mesajı olarak verin. Takım liderinin alt-agent çağırabilmesi seçili model/harness ve `agent` aracının kullanılabilir olmasına bağlıdır. Destek yoksa `AGENTS.md` aynı rolleri uygun olduğunda sıralı yürütmesini ve sınırlamayı raporlamasını ister. Agent tanımları arka planda sürekli çalışan servisler değildir.

`.github/hooks/security-approval.json` ve `security_gate.py`, VS Code Local agent harness'ında seçili riskli araç çağrıları için onay ister. Hook desteği ve kapsamı kullanılan agent harness'ına göre değişir; bu tek başına her ortamda mutlak bir güvenlik sınırı değildir. Workspace güvenilir olmalı ve VS Code'da `chat.useHooks` etkin olmalıdır. Güvenlik ajanı yalnızca inceleme yapar; kullanıcı onayı yerine geçmez.

Agent rollerini doğrudan menüden de seçebilirsiniz. Fakat feature işlerinde koordinasyonu ve QA/review akışını tek yerde tutmak için `team-lead` kullanılması önerilir.

## Skill'ler

Skill klasörü, bir `SKILL.md` yönergesi ve gerekiyorsa ona ait destek dosyalarını içerir. Agent yalnızca o iş için uygun skill'i yüklemelidir.

| Skill | Kaynak | Kullanım |
|---|---|---|
| `frontend-design` | [Anthropic Skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Yeni arayüz veya kapsamlı görsel düzenleme |
| `webapp-testing` | [Anthropic Skills](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | Tarayıcıda çalışan web uygulaması doğrulama; destek dosyaları skill klasöründedir |
| `web-design-guidelines` | [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | UI kullanılabilirliği ve arayüz yönergeleri incelemesi |

Skill'ler açık kaynak depolardan alınmıştır; kaynak ve lisans dosyalarını ilgili klasörlerde koruyun. Proje farklı bir alandaysa ihtiyaca uymayan skill'leri çıkarın veya uygun olanlarla değiştirin.

## Yeni projeye uyarlama

- `AGENTS.md` içindeki proje bağlamını yeni ürünün mimari, teknoloji, test ve güvenlik kurallarıyla doldurun.
- Agent tanımlarındaki görev sınırlarını, kullandığınız diller/araçlar ve depo yapısına göre özelleştirin.
- `qa-engineer` yönergelerine proje test komutlarını ekleyin; test altyapısı yoksa önce hangi test yaklaşımının uygun olacağını planlayın.
- Projenin ihtiyacına göre roller ekleyin/çıkarın; örneğin mobil, platform, veri veya güvenlik uzmanları.
- `.github/skills/` altındaki yönergeleri ve üçüncü taraf lisanslarını gözden geçirin.

GitHub'da bu depoyu template repository olarak işaretleyip yeni projeleri ondan üretebilirsiniz. Template repo ayarını GitHub arayüzünden yapmak gerekir; bu çalışma alanı yalnızca template dosyalarını hazırlar.
