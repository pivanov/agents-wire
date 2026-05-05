<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";
import { computed } from "vue";
import DocFooter from "./DocFooter.vue";

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
const isHome = computed(() => frontmatter.value.layout === "home");
</script>

<template>
  <Layout>
    <template #doc-after>
      <DocFooter v-if="!isHome" />
    </template>
    <template #layout-bottom>
      <div v-if="isHome" class="aw-home-foot-wrap">
        <DocFooter />
      </div>
    </template>
  </Layout>
</template>

<style>
.aw-home-foot-wrap {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}
</style>
