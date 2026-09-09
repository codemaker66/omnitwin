      const craftStories = __CRAFT_STORIES__;
      const craftButtons = [...root.querySelectorAll('.oh-crest')];
      const craftPanel = root.querySelector('.oh-craft-story');
      const craftTitle = root.querySelector('#oh-craft-story-title');
      const craftText = root.querySelector('.oh-story-text');
      const craftSource = root.querySelector('.oh-story-source');
      let selectedCraft = null;
      let craftAnimation;
      function resetCraft(restoreFocus) {
        const previous = selectedCraft;
        craftAnimation?.cancel();
        selectedCraft = null;
        delete root.dataset.craft;
        craftPanel.hidden = true;
        craftButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
        if (restoreFocus && previous !== null) {
          craftButtons[previous].focus({preventScroll:true});
          live.textContent = 'Craft story closed. Choose another badge to meet its Craft.';
        }
      }
      function selectCraft(index) {
        if (state.scene !== 'craft' || !craftStories[index]) return;
        const story = craftStories[index];
        selectedCraft = index;
        root.dataset.craft = story.id;
        craftButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
        craftTitle.textContent = 'The ' + story.name;
        craftText.textContent = story.text;
        root.querySelector('.oh-story-trade').textContent = story.eyebrow;
        root.querySelector('.oh-story-number').textContent = String(index + 1).padStart(2, '0') + ' / 14';
        craftSource.href = story.sourceUrl;
        craftSource.setAttribute('aria-label', 'Explore the history of the ' + story.name);
        craftPanel.hidden = false;
        craftAnimation?.cancel();
        if (!reduced.matches) craftAnimation = craftPanel.animate(
          [{opacity:0, transform:'translateY(12px)'}, {opacity:1, transform:'translateY(0)'}],
          {duration:340, easing:'cubic-bezier(.2,.7,.2,1)'}
        );
        live.textContent = 'The ' + story.name + '. ' + story.text;
        if (window.matchMedia('(max-width: 650px)').matches) {
          craftPanel.scrollIntoView({block:'nearest', behavior:reduced.matches ? 'instant' : 'smooth'});
        }
      }
      craftButtons.forEach((button, index) => {
        button.addEventListener('click', () => selectCraft(index));
        button.addEventListener('keydown', event => {
          let next;
          if (event.key === 'ArrowRight') next = (index + 1) % craftButtons.length;
          else if (event.key === 'ArrowLeft') next = (index + craftButtons.length - 1) % craftButtons.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = craftButtons.length - 1;
          else return;
          event.preventDefault();
          craftButtons[next].focus({preventScroll:true});
          selectCraft(next);
        });
      });
      root.querySelector('.oh-story-close').addEventListener('click', () => resetCraft(true));
