// Debug Script für Decision Card Overflow
// In Browser Console ausführen

(function() {
  console.log('=== DECISION CARD OVERFLOW DEBUG ===\n');

  // Finde Decision Block (h-[250px] container)
  const decisionBlock = document.querySelector('.h-\\[250px\\]');
  if (!decisionBlock) {
    console.error('Decision Block nicht gefunden!');
    return;
  }

  console.log('1. DECISION BLOCK');
  console.log('   offsetHeight:', decisionBlock.offsetHeight + 'px');

  // Finde den Overflow-Container (flex-1 min-h-0 mit overflow-hidden)
  const overflowContainer = decisionBlock.querySelector('.min-h-0.overflow-hidden, .min-h-0');
  if (overflowContainer) {
    const styles = getComputedStyle(overflowContainer);
    console.log('\n2. OVERFLOW CONTAINER (flex-1 min-h-0)');
    console.log('   offsetHeight:', overflowContainer.offsetHeight + 'px');
    console.log('   scrollHeight:', overflowContainer.scrollHeight + 'px');
    console.log('   clientHeight:', overflowContainer.clientHeight + 'px');
    console.log('   overflow:', styles.overflow);
    console.log('   min-height:', styles.minHeight);
    console.log('   Diff (scroll - client):', (overflowContainer.scrollHeight - overflowContainer.clientHeight) + 'px');
    console.log('   hasOverflow?', overflowContainer.scrollHeight > overflowContainer.clientHeight + 5);
    console.log('   Classes:', overflowContainer.className);

    // Finde das Grid darin
    const grid = overflowContainer.querySelector('.grid-cols-2');
    if (grid) {
      console.log('\n3. GRID (kein flex-1)');
      console.log('   offsetHeight:', grid.offsetHeight + 'px');
      console.log('   Classes:', grid.className);
    }
  } else {
    console.log('\n⚠️  Overflow Container nicht gefunden!');
    console.log('Suche nach .min-h-0...');
    const minH0 = decisionBlock.querySelectorAll('.min-h-0');
    console.log('Gefunden:', minH0.length, 'Elemente mit min-h-0');
    minH0.forEach((el, i) => {
      console.log(`   ${i}: ${el.className}`);
    });
  }

  // DOM Struktur
  console.log('\n=== DOM STRUKTUR ===');
  function printTree(el, indent = '', depth = 0) {
    if (depth > 6) return;
    if (el.tagName === 'svg' || el.tagName === 'SVG') return; // Skip SVGs
    const styles = getComputedStyle(el);
    const height = el.offsetHeight;
    const scrollH = el.scrollHeight;
    const overflow = styles.overflow;
    const classStr = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
    const classes = classStr.split(' ').filter(c =>
      c.includes('flex') || c.includes('h-') || c.includes('min-h') || c.includes('overflow') || c.includes('grid')
    ).join(' ');

    console.log(`${indent}<${el.tagName.toLowerCase()} h=${height} scroll=${scrollH} overflow="${overflow}" classes="${classes}">`);

    Array.from(el.children).slice(0, 4).forEach(child => {
      printTree(child, indent + '  ', depth + 1);
    });
  }

  printTree(decisionBlock);
})();
