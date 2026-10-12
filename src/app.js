import { initStore, listData, addIngredient, saveMeal, deleteMeal, getMeal } from './store.js';

const $ = (selector, root = document) => root.querySelector(selector);
const els = {
  search: $('#meal-search'), ingredientList: $('[data-ingredient-list]'), meals: $('[data-meal-grid]'),
  resultCount: $('[data-result-count]'), selectedCount: $('[data-selected-count]'), activeFilters: $('[data-active-filters]'),
  clearSearch: $('.clear-search'), clearFilters: $('.clear-filters'), form: $('[data-meal-form]'), mealDialog: $('[data-meal-dialog]'),
  detailDialog: $('[data-detail-dialog]'), detailContent: $('[data-detail-content]'), formIngredients: $('[data-form-ingredients]'),
  formError: $('[data-form-error]'), photo: $('#meal-photo'), photoLabel: $('[data-photo-label]'), photoPreview: $('[data-photo-preview]'),
  photoRemove: $('[data-action="remove-photo"]'),
  loading: $('[data-loading]'), toast: $('[data-toast]'),
};
let data = { ingredients: [], meals: [] };
let selected = new Set();
let toastTimer;
let previewUrl = null;
let removeExistingPhoto = false;
const imageUrls = new WeakMap();

function normalized(value) { return String(value ?? '').trim().toLocaleLowerCase('tr'); }
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function ingredientName(value) {
  if (typeof value === 'string') return data.ingredients.find(item => item.id === value)?.name ?? value;
  return value?.name ?? data.ingredients.find(item => item.id === value?.ingredientId)?.name ?? '';
}
function mealIngredientIds(meal) {
  return (meal.ingredientIds ?? meal.ingredients ?? []).map(item => typeof item === 'string' ? item : item?.id ?? item?.ingredientId).filter(Boolean);
}
function namesFor(meal) { return mealIngredientIds(meal).map(id => data.ingredients.find(item => item.id === id)?.name ?? ingredientName(id)).filter(Boolean); }
function textMatches(meal, query) {
  if (!query) return true;
  const haystack = [meal.name, ...namesFor(meal)].join(' ').toLocaleLowerCase('tr');
  return haystack.includes(normalized(query));
}
function visibleMeals() {
  const query = els.search.value;
  return data.meals.map(meal => {
    const ids = mealIngredientIds(meal);
    const matched = [...selected].filter(id => ids.includes(id)).length;
    return { meal, matched };
  }).filter(item => textMatches(item.meal, query) && (!selected.size || item.matched > 0))
    .sort((a, b) => b.matched - a.matched || normalized(a.meal.name).localeCompare(normalized(b.meal.name), 'tr'));
}
function imageUrl(meal) {
  const photo = meal.photo ?? meal.photoBlob ?? meal.image;
  if (photo instanceof Blob) {
    if (!imageUrls.has(photo)) imageUrls.set(photo, URL.createObjectURL(photo));
    return imageUrls.get(photo);
  }
  return meal.photoUrl ?? meal.imageUrl ?? (typeof photo === 'string' ? photo : '');
}
function setData(next = listData()) {
  data = { ingredients: next?.ingredients ?? [], meals: next?.meals ?? [] };
  renderIngredients(); renderMeals(); renderFormIngredients();
}
function renderIngredients() {
  const ingredients = [...data.ingredients].sort((a, b) => normalized(a.name).localeCompare(normalized(b.name), 'tr'));
  els.ingredientList.innerHTML = ingredients.length ? ingredients.map(item => `<button class="ingredient-chip" type="button" data-ingredient="${escapeHTML(item.id)}" aria-pressed="${selected.has(item.id)}">${escapeHTML(item.name)}</button>`).join('') : '<p class="ingredient-empty">Henüz malzeme eklenmemiş.</p>';
  els.selectedCount.textContent = `${selected.size} seçili`;
  els.clearFilters.hidden = selected.size === 0;
  els.activeFilters.innerHTML = [...selected].map(id => {
    const item = data.ingredients.find(ingredient => ingredient.id === id);
    return item ? `<span class="active-filter">${escapeHTML(item.name)}<button type="button" data-remove-ingredient="${escapeHTML(id)}" aria-label="${escapeHTML(item.name)} filtresini kaldır">×</button></span>` : '';
  }).join('');
}
function renderMeals() {
  const results = visibleMeals();
  els.resultCount.textContent = `${results.length} ${results.length === 1 ? 'yemek' : 'yemek'}`;
  els.clearSearch.hidden = !els.search.value;
  if (results.length) {
    els.meals.innerHTML = results.map(({ meal, matched }) => {
      const names = namesFor(meal);
      const src = imageUrl(meal);
      return `<article class="meal-card" tabindex="0" role="button" data-meal-id="${escapeHTML(meal.id)}" aria-label="${escapeHTML(meal.name)} detayını aç">
        <div class="meal-photo">${src ? `<img src="${escapeHTML(src)}" alt="${escapeHTML(meal.name)}" loading="lazy">` : '<span class="meal-placeholder" aria-hidden="true">✳</span>'}</div>
        <div class="meal-body"><h3 class="meal-title">${escapeHTML(meal.name)}</h3><div class="meal-tags">${names.slice(0, 3).map(name => `<span class="meal-tag">${escapeHTML(name)}</span>`).join('')}${names.length > 3 ? `<span class="meal-tag more">+${names.length - 3}</span>` : ''}</div>${selected.size ? `<p class="match-note">${matched} seçili malzemeyle eşleşiyor</p>` : ''}</div>
      </article>`;
    }).join('');
  } else {
    const hasFilters = Boolean(els.search.value || selected.size);
    els.meals.innerHTML = `<div class="empty-state"><span class="empty-mark" aria-hidden="true">${hasFilters ? '⌕' : '✳'}</span><h3>${hasFilters ? 'Bu malzemelerle yemek bulamadık' : 'Tarif defterin henüz boş'}</h3><p>${hasFilters ? 'Aramayı değiştirebilir ya da seçtiğin malzemeleri azaltabilirsin. Burada yalnızca kendi kaydettiğin yemekler görünür.' : 'Sevdiğin yemekleri ekle; malzemelerin hazır olduğunda burada buluşalım.'}</p><button class="button button-dark" type="button" data-action="${hasFilters ? 'clear-filters' : 'new-meal'}">${hasFilters ? 'Aramayı temizle' : 'İlk yemeğini ekle'}</button></div>`;
  }
}
function renderFormIngredients() {
  const current = new Set([...els.form.querySelectorAll('[name="ingredientIds"]:checked')].map(input => input.value));
  els.formIngredients.innerHTML = data.ingredients.length ? data.ingredients.map(item => `<label class="form-ingredient"><input type="checkbox" name="ingredientIds" value="${escapeHTML(item.id)}" ${current.has(item.id) ? 'checked' : ''}><span>${escapeHTML(item.name)}</span></label>`).join('') : '<p class="ingredient-empty">Önce bir malzeme ekle.</p>';
}
function openMealForm(meal = null) {
  els.form.reset(); els.formError.hidden = true; els.formError.textContent = '';
  els.form.elements.id.value = meal?.id ?? '';
  els.form.elements.name.value = meal?.name ?? '';
  els.form.elements.instructions.value = meal?.instructions ?? '';
  $('[data-dialog-eyebrow]').textContent = meal ? 'Tarif defterini düzenle' : 'Tarif defterine ekle';
  $('#dialog-title').textContent = meal ? 'Yemeği düzenle' : 'Yeni yemek';
  $('[data-save-button]').textContent = meal ? 'Değişiklikleri kaydet' : 'Yemeği kaydet';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  removeExistingPhoto = false;
  const existingPhoto = meal?.photo instanceof Blob ? meal.photo : null;
  previewUrl = existingPhoto ? URL.createObjectURL(existingPhoto) : null;
  els.photoPreview.innerHTML = previewUrl ? `<img src="${escapeHTML(previewUrl)}" alt="Mevcut yemek fotoğrafı">` : '';
  els.photoLabel.textContent = existingPhoto ? 'Yeni fotoğraf seç' : 'Bir fotoğraf seç';
  els.photoRemove.hidden = !existingPhoto;
  renderFormIngredients();
  const ingredientIds = new Set(mealIngredientIds(meal ?? {}));
  els.form.querySelectorAll('[name="ingredientIds"]').forEach(input => { input.checked = ingredientIds.has(input.value); });
  els.mealDialog.showModal();
  $('#meal-name').focus();
}
function toast(message) {
  els.toast.textContent = message; els.toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 2400);
}
async function refresh() { setData(await listData()); }
async function createIngredient(rawName) {
  const name = rawName.trim();
  if (!name) return null;
  const existing = data.ingredients.find(item => normalized(item.name) === normalized(name));
  if (existing) return existing;
  const created = await addIngredient(name);
  await refresh();
  return created ?? data.ingredients.find(item => normalized(item.name) === normalized(name));
}
function openDetails(id) {
  const meal = data.meals.find(item => item.id === id);
  if (!meal) return;
  const src = imageUrl(meal);
  const ingredients = namesFor(meal);
  els.detailContent.innerHTML = `${src ? `<img class="detail-photo" src="${escapeHTML(src)}" alt="${escapeHTML(meal.name)}">` : '<div class="detail-photo" aria-hidden="true">✳</div>'}<div class="detail-content"><p class="eyebrow">Senin tarif defterin</p><h2 id="detail-title">${escapeHTML(meal.name)}</h2><div class="detail-ingredients">${ingredients.map(name => `<span class="meal-tag">${escapeHTML(name)}</span>`).join('')}</div>${meal.instructions ? `<section class="detail-section"><h3>Hazırlanışı</h3><p>${escapeHTML(meal.instructions)}</p></section>` : '<section class="detail-section"><p>Bu yemek için henüz pişirme notu eklenmemiş.</p></section>'}<div class="detail-actions"><button class="button delete-button" type="button" data-action="delete-meal" data-id="${escapeHTML(id)}">Yemeği sil</button><button class="button button-dark" type="button" data-action="edit-meal" data-id="${escapeHTML(id)}">Düzenle</button></div></div>`;
  els.detailDialog.showModal();
}

document.addEventListener('click', async event => {
  const ingredientButton = event.target.closest('[data-ingredient]');
  if (ingredientButton) {
    const id = ingredientButton.dataset.ingredient;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    renderIngredients(); renderMeals(); return;
  }
  const remove = event.target.closest('[data-remove-ingredient]');
  if (remove) { selected.delete(remove.dataset.removeIngredient); renderIngredients(); renderMeals(); return; }
  const action = event.target.closest('[data-action]');
  if (action) {
    switch (action.dataset.action) {
      case 'new-meal': openMealForm(); break;
      case 'new-ingredient': openMealForm(); $('#new-ingredient-name').focus(); break;
      case 'clear-filters': selected.clear(); els.search.value = ''; renderIngredients(); renderMeals(); break;
      case 'close-dialog': els.mealDialog.close(); break;
      case 'close-detail': els.detailDialog.close(); break;
      case 'remove-photo': {
        removeExistingPhoto = true;
        els.photo.value = '';
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        els.photoPreview.innerHTML = '';
        els.photoLabel.textContent = 'Bir fotoğraf seç';
        els.photoRemove.hidden = true;
        break;
      }
      case 'edit-meal': {
        const meal = await getMeal(action.dataset.id) ?? data.meals.find(item => item.id === action.dataset.id);
        els.detailDialog.close(); openMealForm(meal); break;
      }
      case 'delete-meal': {
        const meal = data.meals.find(item => item.id === action.dataset.id);
        if (meal && window.confirm(`“${meal.name}” yemeğini silmek istiyor musun?`)) {
          await deleteMeal(meal.id); els.detailDialog.close(); await refresh(); toast('Yemek silindi.');
        }
        break;
      }
      case 'add-inline-ingredient': {
        const input = $('#new-ingredient-name');
        if (!input.value.trim()) { input.focus(); break; }
        await createIngredient(input.value);
        const created = data.ingredients.find(item => normalized(item.name) === normalized(input.value));
        renderFormIngredients();
        const checkbox = created && els.form.querySelector(`[name="ingredientIds"][value="${CSS.escape(created.id)}"]`);
        if (checkbox) checkbox.checked = true;
        input.value = ''; input.focus(); break;
      }
    }
    return;
  }
  const card = event.target.closest('[data-meal-id]');
  if (card) openDetails(card.dataset.mealId);
});
els.meals.addEventListener('keydown', event => {
  const card = event.target.closest('[data-meal-id]');
  if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetails(card.dataset.mealId); }
});
els.search.addEventListener('input', renderMeals);
els.clearSearch.addEventListener('click', () => { els.search.value = ''; renderMeals(); els.search.focus(); });
els.photo.addEventListener('change', () => {
  const file = els.photo.files?.[0];
  removeExistingPhoto = false;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = file ? URL.createObjectURL(file) : null;
  els.photoLabel.textContent = file?.name ?? 'Bir fotoğraf seç';
  els.photoPreview.innerHTML = previewUrl ? `<img src="${escapeHTML(previewUrl)}" alt="Seçilen fotoğraf önizlemesi">` : '';
});
els.form.addEventListener('submit', async event => {
  event.preventDefault(); els.formError.hidden = true;
  const ingredientIds = [...els.form.querySelectorAll('[name="ingredientIds"]:checked')].map(input => input.value);
  if (!ingredientIds.length) { els.formError.textContent = 'En az bir malzeme seç veya ekle.'; els.formError.hidden = false; return; }
  const submit = $('[data-save-button]'); submit.disabled = true; submit.textContent = 'Kaydediliyor…';
  try {
    const id = els.form.elements.id.value || undefined;
    const chosenPhoto = els.photo.files?.[0];
    await saveMeal({ id, name: els.form.elements.name.value.trim(), instructions: els.form.elements.instructions.value.trim(), ingredientIds, photo: chosenPhoto ?? (removeExistingPhoto ? null : (id ? undefined : null)) });
    els.mealDialog.close(); await refresh(); toast('Yemek tarif defterine eklendi.');
  } catch (error) {
    els.formError.textContent = error?.message || 'Yemek kaydedilemedi. Lütfen tekrar dene.'; els.formError.hidden = false;
  } finally {
    submit.disabled = false; submit.textContent = els.form.elements.id.value ? 'Değişiklikleri kaydet' : 'Yemeği kaydet';
  }
});
els.mealDialog.addEventListener('click', event => { if (event.target === els.mealDialog) els.mealDialog.close(); });
els.detailDialog.addEventListener('click', event => { if (event.target === els.detailDialog) els.detailDialog.close(); });

els.loading.hidden = false;
try { await initStore(); await refresh(); }
catch (error) {
  console.error('Mealio verisi başlatılamadı:', error);
  const message = error?.message || 'Yerel veriye erişirken bir sorun oluştu.';
  els.meals.innerHTML = `<div class="empty-state"><span class="empty-mark">!</span><h3>Tarif defteri açılamadı</h3><p>${escapeHTML(message)} Sayfayı yenileyip tekrar dene.</p><button class="button button-dark" type="button" onclick="location.reload()">Yeniden dene</button></div>`;
} finally { els.loading.hidden = true; }
